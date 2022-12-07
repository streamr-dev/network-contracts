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
    function getProject(bytes32 id) external view returns (
        address beneficiary,
        uint pricePerSecond,
        address pricingTokenAddress,
        uint minimumSubscriptionSeconds,
        string calldata metadata,
        uint32 version,
        string calldata streams);
    function grantSubscription(bytes32 projectId, uint subscriptionSeconds, address subscriber) external;
    function canBuyProject(bytes32 projectId, address buyer) external view returns(bool isPurchable);
    function getSubscription(bytes32 projectId, address subscriber) external view returns (bool isValid, uint endTimestamp);
    function isTrustedForwarder(address forwarder) external view returns (bool);
}

interface IMessageRecipient {
    function handle(
        uint32 _origin, // the Domain ID of the source chain (e.g. polygon)
        bytes32 _sender, // the address of the message sender on the source chain. It must match or the message will revert (e.g. RemoteMarketplace)
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

    // MarketplaceV3 storage

    struct Product {
        bytes32 id;
        string name;
        address owner;
        address beneficiary;        // account where revenue is directed to
        uint pricePerSecond;
        address pricingTokenAddress;  // the token in which the product is paid to product beneficiary
        uint minimumSubscriptionSeconds;
        ProductState state;
        address newOwnerCandidate;  // Two phase hand-over to minimize the chance that the product ownership is lost to a non-existent address.
        bool requiresWhitelist;
        mapping(address => TimeBasedSubscription) subscriptions;
        mapping(address => WhitelistState) whitelist;
    }

    struct TimeBasedSubscription {
        uint endTimestamp;
    }

    mapping (bytes32 => Product) public products; // Deprecated from v4 since products storage will be handled by ProjectRegistry.

    /** fraction of the purchase revenue that goes to marketplace.owner (1e18 means 100%) */
    uint256 public txFee;

	/** Two phase hand-over to minimize the chance that the product ownership is lost to a non-existent address. */
	address public pendingOwner;

    bool public halted;

    // MarketplaceV4 storage

    IProjectRegistry public projectRegistry;

    // cross-chain messaging
    address public crossChainInbox;
    mapping(uint32 => address) public crossChainMarketplaces;

    modifier whenNotHalted() {
        require(!halted || owner() == _msgSender(), "error_halted");
        _;
    }

    modifier onlyCrossChainMarketplace(uint32 originId, bytes32 senderAddress) {
        require(crossChainMarketplaces[originId] == _bytes32ToAddress(senderAddress), "notCrossChainMarketplace");
        require(msg.sender == crossChainInbox, "notHyperlaneInbox");
        _;
    }

    /////////////// Marketplace lifecycle /////////////////

    // Constructor can't be used with upgradeable contracts, so use initialize instead
    //    due to the initializer modifier, this will not be called upon each upgrade, only once during first deployment
    function initialize() public initializer {
        // since there is no constructor, it initialises the OwnableUpgradeable
        __Ownable_init();
        __UUPSUpgradeable_init();

        halted = false;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function setProjectRegistry(address _projectRegistry) external onlyOwner {
        projectRegistry = IProjectRegistry(_projectRegistry);
    }
    
    function setCrossChainInbox(address inboxAddress) external onlyOwner {
        crossChainInbox = inboxAddress;
    }
    
    function addCrossChainMarketplace(uint32 domainId, address marketplaceAddress) external onlyOwner {
        crossChainMarketplaces[domainId] = marketplaceAddress;
    }

    /**
     * Transfer the product payment to product beneficiary and the fee to marketplace owner
     * Enforces payment rules
     * @dev price & fee is in wei
     */
    function _handleProductPurchase(bytes32 productId, uint addSeconds, address subscriber) internal {
        (address beneficiary, uint pricePerSecond, address pricingTokenAddress, , , , ) = projectRegistry.getProject(productId);
        uint256 price = addSeconds * pricePerSecond;
        uint256 fee = (txFee * price) / 1 ether;
        IERC677 pricingToken = IERC677(pricingTokenAddress);

        // transfer price (amount to beneficiary + fee to marketplace owner) from buyer to marketplace
        require(pricingToken.transferFrom(_msgSender(), address(this), price), "error_paymentFailed");

        (, uint subEndTimestamp) = projectRegistry.getSubscription(productId, subscriber);

        // pricing token is ERC677, so product beneficiary can react to product purchase by implementing onTokenTransfer
        try pricingToken.transferAndCall(beneficiary, price - fee, abi.encodePacked(productId, subscriber, subEndTimestamp, price, fee)) returns (bool success) {
            require(success, "error_transferAndCallProduct");
        } catch {
            // pricing token is NOT ERC677, so product beneficiary can only react to purchase by implementing IPurchaseListener
            require(pricingToken.transfer(beneficiary, price - fee), "error_paymentFailed");
        }

        if (fee > 0) {
            // pricing token is ERC677 and marketplace owner can react to product purchase
            try pricingToken.transferAndCall(owner(), fee, abi.encodePacked(productId, subscriber, subEndTimestamp, price, fee)) returns (bool success) {
                require(success, "error_transferAndCallFee");
            } catch {
                // pricing token is NOT ERC677 and marketplace owner can NOT react to product purchase
                require(pricingToken.transfer(owner(), fee), "error_paymentFailed");
            }
        }

        _notifyPurchaseListener(beneficiary, productId, subscriber, subEndTimestamp, price, fee);
        emit ProjectPurchased(productId, subscriber, addSeconds, price, fee);
    }

    /**
     * Notify the purchase listener of product purchase
     * @param beneficiary is the product beneficiary (the address getting paid for product)
     * @param subscriber is the address for which the project subscription is added/extended
    */
    function _notifyPurchaseListener(address beneficiary, bytes32 productId, address subscriber, uint256 subEndTimestamp, uint256 price, uint256 fee) private {
        uint256 codeSize;
        assembly { codeSize := extcodesize(beneficiary) }  // solhint-disable-line no-inline-assembly
        if (codeSize > 0) {
            try IPurchaseListener(beneficiary).onPurchase(productId, subscriber, subEndTimestamp, price, fee) returns (bool accepted) {
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
    function buyFor(bytes32 productId, uint subscriptionSeconds, address subscriber) public override whenNotHalted {
        require(projectRegistry.canBuyProject(productId, subscriber), "error_unableToBuyProject");

        // Marketplaces isTrusted by the project registry
        projectRegistry.grantSubscription(productId, subscriptionSeconds, subscriber);

        _handleProductPurchase(productId, subscriptionSeconds, subscriber);
    }

    /**
     * Purchases access to this project for msg.sender.
     * If the address already has a valid subscription, extends the subscription by the given period.
     */
    function buy(bytes32 productId, uint subscriptionSeconds) public whenNotHalted {
        buyFor(productId, subscriptionSeconds, _msgSender());
    }

    /**
     * ERC677 token callback
     * If the data bytes contains a product id, the subscription is extended for that product
     * @dev The amount transferred is in pricingTokenAddress.
     * @param sender The EOA initiating the transaction through transferAndCall.
     * @param amount The amount to be transferred (in wei).
     * @param data Product id in bytes32.
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        require(data.length == 32, "error_badProductId");

        bytes32 productId;
        assembly { productId := calldataload(data.offset) } // solhint-disable-line no-inline-assembly

        ( , uint pricePerSecond, address pricingTokenAddress, , , , ) = projectRegistry.getProject(productId);
        require(_msgSender() == pricingTokenAddress, "error_wrongPricingToken");

        uint subscriptionSeconds = amount / pricePerSecond / 1 ether;
        projectRegistry.grantSubscription(productId, subscriptionSeconds, sender);
    }

    /////////////// Cross-Chain Purchases ///////////////

    /**
    * Extends project subscription purchased on a different chain.
    * @dev decode projectId, subscriber, subscriptionSeconds from _data
    * @dev msg.sender is the hyperlane mailbox address from the source chain, where MarketplaceV4 is deployed (e.g. polygon)
    * @param _origin - the chain id (e.g. polygon). It's a unique id assignet by hyperlane protocol.
    * @param _sender - the contract from which the tx was inited (e.g. RemoteMarketplace).
    * @dev _sender is bytes32 not address because the protocol intends to support non-evm chains as well
    * @param _data - encoded purchase info
    */
    function handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _data
    ) external onlyCrossChainMarketplace(_origin, _sender) {
        (bytes32 productId, uint256 subscriptionSeconds, address subscriber) = abi.decode(_data, (bytes32, uint256, address));

        require(projectRegistry.canBuyProject(productId, subscriber), "error_unableToBuyProject");
        projectRegistry.grantSubscription(productId, subscriptionSeconds, subscriber);

        emit ProjectPurchased(productId, subscriber, subscriptionSeconds, 0, 0); // TODO: add price and fee params
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
