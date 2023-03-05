/**
 * Deployed on polygon on 2023-02-22
 * https://polygonscan.com/tx/0x76859b523227acc89e6c9bccc12f8c32cc912de494d50b912fc093bbf2efda8f
 */

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../token/IERC677.sol";
import "./IPurchaseListener.sol";
import "./IMarketplaceV4.sol";
import "./IMessageRecipient.sol";

interface IProjectRegistryV1 {
    enum PermissionType {  Buy, Delete, Edit, Grant }
    function getPaymentDetailsByChain(
        bytes32 projectId,
        uint32 domainId
    ) external view returns (
        address beneficiary,
        address pricingTokenAddress,
        uint256 pricePerSecond,
        uint256 streamsCount
    );
    function grantSubscription(bytes32 projectId, uint256 subscriptionSeconds, address subscriber) external;
    function canBuyProject(bytes32 projectId, address buyer) external view returns(bool isPurchable);
    function getSubscription(bytes32 projectId, address subscriber) external view returns (bool isValid, uint256 endTimestamp);
    function isTrustedForwarder(address forwarder) external view returns (bool);
}

/**
 * @title Streamr Marketplace
 * @dev note about numbers:
 *   All prices and exchange rates are in "decimal fixed-point", that is, scaled by 10^18, like ETH vs wei.
 *  Seconds are integers as usual.
 */
contract MarketplaceV4 is Initializable, OwnableUpgradeable, UUPSUpgradeable, IMarketplaceV4, IMessageRecipient {

    /** fraction of the purchase revenue that goes to marketplace.owner (1e18 means 100%) */
    uint256 public txFee;

	/** Two phase hand-over to minimize the chance that the project ownership is lost to a non-existent address. */
	address public pendingOwner;

    bool public halted;

    IProjectRegistryV1 public projectRegistry;

    // cross-chain messaging
    uint32 public chainId; // unique identifier for current chain (assigned by Hyperlane, but the same as the chainId in the EIP-155)
    address public mailbox; // address of the Hyperlane Mailbox contract
    mapping(uint32 => address) public remoteMarketplaces; // the key is the remote chain's id

    modifier whenNotHalted() {
        require(!halted || owner() == _msgSender(), "error_halted");
        _;
    }

    modifier onlyRemoteMarketplace(uint32 originChainId, bytes32 senderAddress) {
        require(msg.sender == mailbox, "error_notHyperlaneMailbox");
        require(remoteMarketplaces[originChainId] == _bytes32ToAddress(senderAddress), "error_notRemoteMarketplace");
        _;
    }

    function initialize(address _projectRegistry, uint32 _chainId) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        halted = false;
        projectRegistry = IProjectRegistryV1(_projectRegistry);
        chainId = _chainId;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /////////////// Marketplace lifecycle /////////////////

    /**
     * Transfer the project payment to project beneficiary and the fee to marketplace owner
     * Enforces payment rules
     * @dev price & fee is in wei
     */
    function _handleProjectPurchase(bytes32 projectId, uint256 addSeconds, address subscriber) internal {
        (address beneficiary, address pricingTokenAddress, uint256 pricePerSecond, ) = projectRegistry.getPaymentDetailsByChain(projectId, chainId);
        require(pricePerSecond > 0, "error_freeProjectsNotSupportedOnMarketplace");
        uint256 price = addSeconds * pricePerSecond;
        uint256 fee = (txFee * price) / 1 ether;
        IERC677 pricingToken = IERC677(pricingTokenAddress);

        // transfer price (amount to beneficiary + fee to marketplace owner) from buyer to marketplace
        require(pricingToken.transferFrom(_msgSender(), address(this), price), "error_paymentFailed");
        (, uint256 subEndTimestamp) = projectRegistry.getSubscription(projectId, subscriber);

        // pricing token is ERC677, so project beneficiary can react to project purchase by implementing onTokenTransfer
        try pricingToken.transferAndCall(beneficiary, price - fee, abi.encodePacked(projectId, subscriber, subEndTimestamp, price, fee)) returns (bool success) {
            require(success, "error_transferAndCallProject");
        } catch {
            // pricing token is NOT ERC677, so project beneficiary can only react to purchase by implementing IPurchaseListener
            require(pricingToken.transfer(beneficiary, price - fee), "error_paymentFailed");
        }

        if (fee > 0) {
            // pricing token is ERC677 and marketplace owner can react to project purchase
            try pricingToken.transferAndCall(owner(), fee, abi.encodePacked(projectId, subscriber, subEndTimestamp, price, fee)) returns (bool success) {
                require(success, "error_transferAndCallFee");
            } catch {
                // pricing token is NOT ERC677 and marketplace owner can NOT react to project purchase
                require(pricingToken.transfer(owner(), fee), "error_paymentFailed");
            }
        }

        _notifyPurchaseListener(beneficiary, projectId, subscriber, subEndTimestamp, price, fee);
        emit ProjectPurchased(projectId, subscriber, addSeconds, price, fee);
    }

    /**
     * Notify the purchase listener of project purchase
     * @param beneficiary is the project beneficiary (the address getting paid for project)
     * @dev if the beneficiary is a contract, it can implement IPurchaseListener to react to project purchase
     * @param subscriber is the address for which the project subscription is added/extended
    */
    function _notifyPurchaseListener(address beneficiary, bytes32 projectId, address subscriber, uint256 subEndTimestamp, uint256 price, uint256 fee) private {
        uint256 codeSize;
        assembly { codeSize := extcodesize(beneficiary) }  // solhint-disable-line no-inline-assembly
        if (codeSize > 0) {
            try IPurchaseListener(beneficiary).onPurchase(projectId, subscriber, subEndTimestamp, price, fee) returns (bool accepted) {
                require(accepted, "error_rejectedBySeller");
            } catch {
                // purchase listener not notified
            }
        }
    }

    /**
     * Pay subscription for someone else
     * @param subscriber is the address for which the project subscription is added/extended
    */
    function buyFor(bytes32 projectId, uint256 subscriptionSeconds, address subscriber) public whenNotHalted {
        require(projectRegistry.canBuyProject(projectId, subscriber), "error_unableToBuyProject");

        // MarketplaceV4 isTrusted by the project registry
        projectRegistry.grantSubscription(projectId, subscriptionSeconds, subscriber);

        _handleProjectPurchase(projectId, subscriptionSeconds, subscriber);
    }

    /**
     * Purchases access to this project for msg.sender.
     * If the address already has a valid subscription, extends the subscription by the given period.
     */
    function buy(bytes32 projectId, uint256 subscriptionSeconds) public whenNotHalted {
        buyFor(projectId, subscriptionSeconds, _msgSender());
    }

    /**
     * ERC677 token callback
     * If the data bytes contains a project id, the subscription is extended for that project
     * @dev The amount transferred is in pricingTokenAddress.
     * @param sender The EOA initiating the transaction through transferAndCall.
     * @param amount The amount to be transferred (in wei).
     * @param data Project id in bytes32.
     */
    function onTokenTransfer(address sender, uint256 amount, bytes calldata data) external {
        require(data.length == 32, "error_badProjectId");

        bytes32 projectId;
        assembly { projectId := calldataload(data.offset) } // solhint-disable-line no-inline-assembly

        ( , address pricingTokenAddress, uint256 pricePerSecond, ) = projectRegistry.getPaymentDetailsByChain(projectId, chainId);
        require(_msgSender() == pricingTokenAddress, "error_wrongPricingToken");

        uint256 subscriptionSeconds = amount / pricePerSecond / 1 ether;
        projectRegistry.grantSubscription(projectId, subscriptionSeconds, sender);
    }

    /////////////// Cross-Chain Messaging ///////////////

    function addMailbox(address mailboxAddress) external onlyOwner {
        mailbox = mailboxAddress;
    }
    
    function addRemoteMarketplace(uint32 remoteChainId, address remoteMarketplaceAddress) external onlyOwner {
        remoteMarketplaces[remoteChainId] = remoteMarketplaceAddress;
    }

    /**
     * RemoteMarketplace calls this function to get purchase informations about a project.
     */
    function getPurchaseInfo(
        bytes32 projectId,
        uint256 subscriptionSeconds,
        uint32 originDomainId,
        uint256 purchaseId
    ) external view returns(address, address, uint256, uint256, uint256, uint256) {
        (address beneficiary, address pricingTokenAddress, uint256 pricePerSecond, uint256 streamsCount ) = projectRegistry.getPaymentDetailsByChain(projectId, originDomainId);
        uint256 price = subscriptionSeconds * pricePerSecond;
        return (beneficiary, pricingTokenAddress, price, (txFee * price) / 1 ether, purchaseId, streamsCount);
    }

    function getSubscriptionInfo(
        bytes32 projectId,
        address subscriber,
        uint256 purchaseId
    ) external view returns(bool, uint256, uint256) {
        (bool isValid, uint256 subEndTimestamp) = projectRegistry.getSubscription(projectId, subscriber);
        return (isValid, subEndTimestamp, purchaseId);
    }

    /**
    * Extends project subscription purchased on a different chain.
    * @param _origin - the chain id where the sender contract is deployed (e.g. RemoteMarketplace).
    * @param _sender - the contract sending the message (e.g. RemoteMarketplace).
    * @param _message - encoded purchase info
    * @dev _sender is of type bytes32 not address because the protocol will support non-evm chains as well
    * @dev msg.sender is the hyperlane Mailbox of the chain where this contract is deployed
    */
    function handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _message
    ) external onlyRemoteMarketplace(_origin, _sender) {
        (bytes32 projectId, address subscriber, uint256 subscriptionSeconds) = abi.decode(_message, (bytes32, address, uint256));
        projectRegistry.grantSubscription(projectId, subscriptionSeconds, subscriber);
    }

    function _bytes32ToAddress(bytes32 _buf) private pure returns (address) {
        return address(uint160(uint256(_buf)));
    }

    /////////////// Admin functionality ///////////////

    function halt() public onlyOwner {
        halted = true;
        emit Halted();
    }

    function resume() public onlyOwner {
        halted = false;
        emit Resumed();
    }

    /**
     * @dev Override openzeppelin implementation
	 * @dev Allows the current owner to set the pendingOwner address.
	 * @param newOwner The address to transfer ownership to.
	 */
	function transferOwnership(address newOwner) public override onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
		pendingOwner = newOwner;
	}

    /**
	 * @dev Allows the pendingOwner address to finalize the transfer.
	 */
	function claimOwnership() public {
		require(_msgSender() == pendingOwner, "onlyPendingOwner");
		_transferOwnership(pendingOwner);
		pendingOwner = address(0);
	}

    /**
     * @dev Disable openzeppelin renounce ownership functionality
     */
    function renounceOwnership() public override onlyOwner {}

    /** Fraction of the purchase revenue that goes to marketplace.owner, times 1e18 ("1 ether" means 100%) */
    function setTxFee(uint256 newTxFee) public onlyOwner {
        require(newTxFee <= 1 ether, "error_invalidTxFee");
        txFee = newTxFee;
        emit TxFeeChanged(txFee);
    }

    /////////////// Trusted Forwarder ///////////////

    /**
     * ERC2771ContextUpgradeable implementation from openzeppelin
     * @dev ERC2771ContextUpgradeable inheritance is not possible since it changes the storage layout
     */
    function _msgSender() internal view virtual override returns (address sender) {
        if (isTrustedForwarder(msg.sender)) {
            // The assembly code is more direct than the Solidity version using `abi.decode`.
            assembly { // solhint-disable-line no-inline-assembly
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            return super._msgSender();
        }
    }

    function _msgData() internal view virtual override returns (bytes calldata) {
        if (isTrustedForwarder(msg.sender)) {
            return msg.data[:msg.data.length - 20];
        } else {
            return super._msgData();
        }
    }

    /**
     * @dev isTrustedForwarder and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view returns (bool) {
        if (address(projectRegistry) == (address(0x0))) {
            // projectRegistry was not initialised yet
            return false;
        }
        return projectRegistry.isTrustedForwarder(forwarder);
    }
}
