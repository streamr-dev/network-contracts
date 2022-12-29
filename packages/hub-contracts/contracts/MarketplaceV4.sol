/**
 * Upgraded on: not yet deployed
 * https://polygonscan.com/tx/ not yet deployed
 * DO NOT EDIT
 * Instead, make a copy with new version number
 */

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./token/IERC677.sol";

import "./IMarketplaceV4.sol";
import "./IPurchaseListener.sol";

interface IProjectRegistry {
    enum PermissionType {  Buy, Delete, Edit, Grant }
    struct PaymentDetails {
        address beneficiary; // account where revenue is directed to
        address pricingTokenAddress; // the token in which the project is paid to project beneficiary
        uint256 pricePerSecond;
    }
    function getProject(
        bytes32 id,
        uint32[] memory domainIds
    ) external view returns (
        PaymentDetails[] calldata paymentDetails,
        uint256 minimumSubscriptionSeconds,
        string calldata metadata,
        uint32 version,
        string[] calldata streams
    );
    function grantSubscription(bytes32 projectId, uint256 subscriptionSeconds, address subscriber) external;
    function canBuyProject(bytes32 projectId, address buyer) external view returns(bool isPurchable);
    function getSubscription(bytes32 projectId, address subscriber) external view returns (bool isValid, uint256 endTimestamp);
    function isTrustedForwarder(address forwarder) external view returns (bool);
}

interface IMessageRecipient {
    function handle(
        uint32 _origin, // the Domain ID of the origin chain. It's a unique id assigned by the Hyperlane protocol.
        bytes32 _sender, // the address of the remote contract on the origin chain (e.g. RemoteMarketplace). It must match or the message will revert
        bytes calldata _message // encoded purchase info
    ) external;
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

    IProjectRegistry public projectRegistry;

    // cross-chain messaging
    uint32[] public domainIds;
    mapping(uint32 => address) public domainIdToCrossChainInbox; // key is the remote chain's Domain ID (assigned by Hyperlane)
    mapping(uint32 => address) public domainIdToCrossChainMarketplace; // key is the remote chain's Domain ID (assigned by Hyperlane)

    modifier whenNotHalted() {
        require(!halted || owner() == _msgSender(), "error_halted");
        _;
    }

    modifier onlyCrossChainMarketplace(uint32 originDomainId, bytes32 senderAddress) {
        require(domainIdToCrossChainMarketplace[originDomainId] == _bytes32ToAddress(senderAddress), "error_notCrossChainMarketplace");
        require(msg.sender == domainIdToCrossChainInbox[originDomainId], "error_notHyperlaneInbox");
        _;
    }

    /////////////// Marketplace lifecycle /////////////////

    // Constructor can't be used with upgradeable contracts, so use initialize instead
    //    due to the initializer modifier, this will not be called upon each upgrade, only once during first deployment
    function initialize(address _projectRegistry, uint32 _deployedOnDomainId) public initializer {
        // since there is no constructor, it initialises the OwnableUpgradeable
        __Ownable_init();
        __UUPSUpgradeable_init();

        halted = false;
        projectRegistry = IProjectRegistry(_projectRegistry);
        domainIds.push(_deployedOnDomainId);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function addCrossChainInbox(uint32 originDomainId, address inboxAddress) external onlyOwner {
        domainIdToCrossChainInbox[originDomainId] = inboxAddress;
    }
    
    function addCrossChainMarketplace(uint32 originDomainId, address remoteMarketplaceAddress) external onlyOwner {
        domainIdToCrossChainMarketplace[originDomainId] = remoteMarketplaceAddress;
    }

    /**
     * Transfer the project payment to project beneficiary and the fee to marketplace owner
     * Enforces payment rules
     * @dev price & fee is in wei
     */
    function _handleProjectPurchase(bytes32 projectId, uint256 addSeconds, address subscriber) internal {
        (IProjectRegistry.PaymentDetails[] memory paymentDetails, , , , ) = projectRegistry.getProject(projectId, domainIds);
        address beneficiary = paymentDetails[0].beneficiary;
        uint256 pricePerSecond = paymentDetails[0].pricePerSecond;
        require(pricePerSecond > 0, "error_freeProjectsNotSupportedOnMarketplace");
        address pricingTokenAddress = paymentDetails[0].pricingTokenAddress;
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

    function getPurchaseInfo(
        bytes32 projectId,
        uint256 subscriptionSeconds,
        uint32[] calldata chains,
        uint256 purchaseId
    ) external view returns(
        address beneficiary,
        address pricingTokenAddress,
        uint256 price,
        uint256 fee,
        uint256 // purchaseId
    ) {
        (IProjectRegistry.PaymentDetails[] memory paymentDetails, , , , ) = projectRegistry.getProject(projectId, chains);
        price = subscriptionSeconds * paymentDetails[0].pricePerSecond;
        fee = (txFee * price) / 1 ether;
        return (paymentDetails[0].beneficiary, paymentDetails[0].pricingTokenAddress, price, fee, purchaseId);
    }

    /**
     * Pay subscription for someone else
     * @param subscriber is the address for which the project subscription is added/extended
    */
    function buyFor(bytes32 projectId, uint256 subscriptionSeconds, address subscriber) public override whenNotHalted {
        require(projectRegistry.canBuyProject(projectId, subscriber), "error_unableToBuyProject");

        // Marketplaces isTrusted by the project registry
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

        (IProjectRegistry.PaymentDetails[] memory paymentDetails, , , , ) = projectRegistry.getProject(projectId, domainIds);
        require(_msgSender() == paymentDetails[0].pricingTokenAddress, "error_wrongPricingToken");

        uint256 subscriptionSeconds = amount / paymentDetails[0].pricePerSecond / 1 ether;
        projectRegistry.grantSubscription(projectId, subscriptionSeconds, sender);
    }

    /////////////// Cross-Chain Purchases ///////////////

    /**
    * Extends project subscription purchased on a different chain.
    * @param _origin - the domain id, of the chain, the message is comming from (e.g. RemoteMarketplace).
    * @param _sender - the contract the message is comming from (e.g. RemoteMarketplace).
    * @dev _sender is bytes32 not address because the protocol will support non-evm chains as well
    * @dev msg.sender is the hyperlane inbox address for the destination chain where destination contract is deployed (e.g. MarketplaceV4)
    * @param _data - encoded purchase info
    */
    function handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _data
    ) external onlyCrossChainMarketplace(_origin, _sender) {
        (bytes32 projectId, uint256 subscriptionSeconds, address subscriber) = abi.decode(_data, (bytes32, uint256, address));

        require(projectRegistry.canBuyProject(projectId, subscriber), "error_unableToBuyProject");
        projectRegistry.grantSubscription(projectId, subscriptionSeconds, subscriber);

        emit ProjectPurchased(projectId, subscriber, subscriptionSeconds, 0, 0); // TODO: add price and fee params
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
