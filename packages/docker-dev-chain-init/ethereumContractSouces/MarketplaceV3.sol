// SPDX-License-Identifier: MIT

// solhint-disable not-rely-on-time
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol"; // TODO: replace with AccessControlUpgradeable
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";


import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; // TODO: remove

import "./IPurchaseListener.sol"; // Keep for now and deprecate in v4
import "./IMarketplace.sol";

/**
 * @title Streamr Marketplace
 * @dev note about numbers:
 *   All prices and exchange rates are in "decimal fixed-point", that is, scaled by 10^18, like ETH vs wei.
 *  Seconds are integers as usual.
 *
 * Next version TODO:
 *  - EIP-165 inferface definition; PurchaseListener
 */
contract MarketplaceV3 is Initializable, OwnableUpgradeable, UUPSUpgradeable, IMarketplace {
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

    mapping (bytes32 => Product) public products;

    /** fraction of the purchase revenue that goes to marketplace.owner (1e18 means 100%) */
    uint256 public txFee;

	/** Two phase hand-over to minimize the chance that the product ownership is lost to a non-existent address. */
	address public pendingOwner;

    bool public halted;

    modifier whenNotHalted() {
        require(!halted || owner() == msg.sender, "error_halted");
        _;
    }

    // also checks that p exists: p.owner == 0x0 for non-existent products
    modifier onlyProductOwner(bytes32 productId) {
        (,address _owner,,,,,,) = getProduct(productId);
        require(_owner != address(0), "error_notFound");
        require(_owner == msg.sender || owner() == _msgSender(), "error_productOwnersOnly");
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

    ////////////////// Product management /////////////////

    /*
     * Retreives the product, by its id, from the marketplace
     */
    function getProduct(
        bytes32 id
    ) public override view returns (
        string memory name,
        address owner,
        address beneficiary,
        uint pricePerSecond,
        address pricingTokenAddress,
        uint minimumSubscriptionSeconds,
        ProductState state,
        bool requiresWhitelist
    ) {
        Product storage p = products[id];
        return (
            p.name,
            p.owner,
            p.beneficiary,
            p.pricePerSecond,
            p.pricingTokenAddress,
            p.minimumSubscriptionSeconds,
            p.state,
            p.requiresWhitelist
        );
    }

    function createProduct(bytes32 id, string memory name, address beneficiary, uint pricePerSecond, address pricingToken, uint minimumSubscriptionSeconds) public whenNotHalted {
        _createProduct(id, name, msg.sender, beneficiary, pricePerSecond, pricingToken, minimumSubscriptionSeconds, false);
    }

    function createProductWithWhitelist(bytes32 id, string memory name, address beneficiary, uint pricePerSecond, address pricingToken, uint minimumSubscriptionSeconds) public whenNotHalted {
        _createProduct(id, name, msg.sender, beneficiary, pricePerSecond, pricingToken, minimumSubscriptionSeconds, true);
        emit WhitelistEnabled(id);
    }


    function _createProduct(bytes32 id, string memory name, address productOwner, address beneficiary, uint pricePerSecond, address pricingToken, uint minimumSubscriptionSeconds, bool requiresWhitelist) internal {
        require(id != 0x0, "error_nullProductId");
        require(pricePerSecond > 0, "error_freeProductsNotSupported");
        require(bytes(ERC20(pricingToken).symbol()).length > 0, "error_invalidPricingTokenSymbol");

        (,address _owner,,,,,,) = getProduct(id);
        require(_owner == address(0), "error_alreadyExists");
        
        Product storage p = products[id];
        p.id = id;
        p.name = name;
        p.owner = productOwner;
        p.beneficiary = beneficiary;
        p.pricePerSecond = pricePerSecond;
        p.pricingTokenAddress = pricingToken;
        p.minimumSubscriptionSeconds = minimumSubscriptionSeconds;
        p.state = ProductState.Deployed;
        p.newOwnerCandidate = address(0);
        p.requiresWhitelist = requiresWhitelist;

        emit ProductCreated(productOwner, id, name, beneficiary, pricePerSecond, pricingToken, minimumSubscriptionSeconds);
    }

    /**
    * Stop offering the product
    */
    function deleteProduct(bytes32 productId) public onlyProductOwner(productId) {
        Product storage p = products[productId];
        require(p.state == ProductState.Deployed, "error_notDeployed");
        p.state = ProductState.NotDeployed;
        emit ProductDeleted(p.owner, productId, p.name, p.beneficiary, p.pricePerSecond, p.pricingTokenAddress, p.minimumSubscriptionSeconds);
    }

    /**
    * Return product to market
    */
    function redeployProduct(bytes32 productId) public onlyProductOwner(productId) {
        Product storage p = products[productId];
        require(p.state == ProductState.NotDeployed, "error_mustBeNotDeployed");
        p.state = ProductState.Deployed;
        emit ProductRedeployed(p.owner, productId, p.name, p.beneficiary, p.pricePerSecond, p.pricingTokenAddress, p.minimumSubscriptionSeconds);
    }

    /**
    * @param redeploy allows to "un-delete" a product back to marketplace AND change its info in one tx. This is good for the UI.
    */
    function updateProduct(
        bytes32 productId,
        string memory name,
        address beneficiary,
        uint pricePerSecond,
        address pricingToken,
        uint minimumSubscriptionSeconds,
        bool redeploy
    ) public onlyProductOwner(productId) {
        require(pricePerSecond > 0, "error_freeProductsNotSupported");
        Product storage p = products[productId];
        p.name = name;
        p.beneficiary = beneficiary;
        p.pricePerSecond = pricePerSecond;
        p.pricingTokenAddress = pricingToken;
        p.minimumSubscriptionSeconds = minimumSubscriptionSeconds;
        emit ProductUpdated(p.owner, p.id, name, beneficiary, pricePerSecond, pricingToken, minimumSubscriptionSeconds);
        if (redeploy) {
            redeployProduct(productId);
        }
    }

    /**
    * Changes ownership of the product. Two phase hand-over minimizes the chance that the product ownership is lost to a non-existent address.
    */
    function offerProductOwnership(bytes32 productId, address newOwnerCandidate) public onlyProductOwner(productId) {
        // that productId exists is already checked in onlyProductOwner
        products[productId].newOwnerCandidate = newOwnerCandidate;
        emit ProductOwnershipOffered(products[productId].owner, productId, newOwnerCandidate);
    }

    /**
    * Changes ownership of the product. Two phase hand-over minimizes the chance that the product ownership is lost to a non-existent address.
    */
    function claimProductOwnership(bytes32 productId) public whenNotHalted {
        // also checks that productId exists (newOwnerCandidate is zero for non-existent)
        Product storage p = products[productId];
        require(msg.sender == p.newOwnerCandidate, "error_notPermitted");
        emit ProductOwnershipChanged(msg.sender, productId, p.owner);
        p.owner = msg.sender;
        p.newOwnerCandidate = address(0);
    }

    /////////////// Whitelist management ///////////////

    function setRequiresWhitelist(bytes32 productId, bool _requiresWhitelist) public onlyProductOwner(productId) {
        Product storage p = products[productId];
        require(p.id != 0x0, "error_notFound");
        p.requiresWhitelist = _requiresWhitelist;
        if (_requiresWhitelist) {
            emit WhitelistEnabled(productId);
        } else {
            emit WhitelistDisabled(productId);
        }
    }

    function whitelistApprove(bytes32 productId, address subscriber) public onlyProductOwner(productId) {
        Product storage p = products[productId];
        require(p.id != 0x0, "error_notFound");
        require(p.requiresWhitelist, "error_whitelistNotEnabled");
        p.whitelist[subscriber] = WhitelistState.Approved;
        emit WhitelistApproved(productId, subscriber);
    }

    function whitelistReject(bytes32 productId, address subscriber) public onlyProductOwner(productId) {
        Product storage p = products[productId];
        require(p.id != 0x0, "error_notFound");
        require(p.requiresWhitelist, "error_whitelistNotEnabled");
        p.whitelist[subscriber] = WhitelistState.Rejected;
        emit WhitelistRejected(productId, subscriber);
    }

    function whitelistRequest(bytes32 productId) public {
        Product storage p = products[productId];
        require(p.id != 0x0, "error_notFound");
        require(p.requiresWhitelist, "error_whitelistNotEnabled");
        require(p.whitelist[msg.sender] == WhitelistState.None, "error_whitelistRequestAlreadySubmitted");
        p.whitelist[msg.sender] = WhitelistState.Pending;
        emit WhitelistRequested(productId, msg.sender);
    }

    function getWhitelistState(bytes32 productId, address subscriber) public view returns (WhitelistState wlstate) {
        (, address _owner,,,,,,) = getProduct(productId);
        require(_owner != address(0), "error_notFound");
        // if product doesn't exist this will return 0 (WhitelistState.None)
        Product storage p = products[productId];
        return p.whitelist[subscriber];
    }

    /////////////// Subscription management ///////////////

    function getSubscription(bytes32 productId, address subscriber) public override view returns (bool isValid, uint endTimestamp) {
        (, TimeBasedSubscription storage sub) = _getSubscription(productId, subscriber);
        return (_isValid(sub), sub.endTimestamp);
    }

    function getSubscriptionTo(bytes32 productId) public view returns (bool isValid, uint endTimestamp) {
        return getSubscription(productId, msg.sender);
    }

    /**
     * Checks if the given address currently has a valid subscription
     * @param productId to check
     * @param subscriber to check
     */
    function hasValidSubscription(bytes32 productId, address subscriber) public view returns (bool isValid) {
        (isValid,) = getSubscription(productId, subscriber);
    }

    /**
     * Enforces payment rules, triggers PurchaseListener event
     * Extends subscription endTimestamp by addSeconds amounts
     */
    function _subscribe(bytes32 productId, uint addSeconds, address subscriber) internal {
        (Product storage p, TimeBasedSubscription storage oldSub) = _getSubscription(productId, subscriber);
        require(p.state == ProductState.Deployed, "error_notDeployed");
        require(!p.requiresWhitelist || p.whitelist[subscriber] == WhitelistState.Approved, "error_whitelistNotAllowed");
        
        uint endTimestamp;
        if (oldSub.endTimestamp > block.timestamp) {
            require(addSeconds > 0, "error_topUpTooSmall");
            endTimestamp = oldSub.endTimestamp + addSeconds;
            oldSub.endTimestamp = endTimestamp;
            emit SubscriptionExtended(p.id, subscriber, endTimestamp);
        } else {
            require(addSeconds >= p.minimumSubscriptionSeconds, "error_newSubscriptionTooSmall");
            endTimestamp = block.timestamp + addSeconds;
            TimeBasedSubscription memory newSub = TimeBasedSubscription(endTimestamp);
            p.subscriptions[subscriber] = newSub;
            emit NewSubscription(p.id, subscriber, endTimestamp);
        }

        emit Subscribed(p.id, subscriber, endTimestamp);
    }

    /**
     * Transfer the product payment to product beneficiary and the fee to contract owner
     * @param subscriber is the address for which the product subscription is extended
     */
    function _handleProductPurchase(bytes32 productId, uint addSeconds, address subscriber) internal {
        (Product storage p, TimeBasedSubscription storage oldSub) = _getSubscription(productId, subscriber);
        
        uint256 price = addSeconds * p.pricePerSecond;
        uint256 fee = (txFee * price) / 1 ether;
        address recipient = p.beneficiary;
        ERC20 productToken = ERC20(p.pricingTokenAddress);
        require(productToken.transferFrom(msg.sender, recipient, price - fee), "error_paymentFailed");
        if (fee > 0) {
            require(productToken.transferFrom(msg.sender, owner(), fee), "error_paymentFailed");
        }

        // Notify purchase listener
        uint256 codeSize;
        assembly { codeSize := extcodesize(recipient) }  // solhint-disable-line no-inline-assembly
        if (codeSize > 0) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory returnData) = recipient.call(
                abi.encodeWithSignature("onPurchase(bytes32,address,uint256,uint256,uint256)",
                productId, subscriber, oldSub.endTimestamp, price, fee)
            );

            if (success) {
                (bool accepted) = abi.decode(returnData, (bool));
                require(accepted, "error_rejectedBySeller");
            }
        }
    }

    /** Product owner can give access to product also to non-buyers, TODO: owner can give access through StreamRegistry directly, is this function needed? */
    function grantSubscription(bytes32 productId, uint subscriptionSeconds, address recipient) public whenNotHalted onlyProductOwner(productId){
        _subscribe(productId, subscriptionSeconds, recipient);
    }

    /** Pay subscription for someone else */
    function buyFor(bytes32 productId, uint subscriptionSeconds, address recipient) public override whenNotHalted {
        _subscribe(productId, subscriptionSeconds, recipient);
        _handleProductPurchase(productId, subscriptionSeconds, recipient);
    }


    /**
     * Purchases access to this stream for msg.sender. TODO: user _msgSender()
     * If the address already has a valid subscription, extends the subscription by the given period.
     * @dev since v4.0: Notify the seller if the seller implements PurchaseListener interface
     */
    function buy(bytes32 productId, uint subscriptionSeconds) public whenNotHalted {
        buyFor(productId, subscriptionSeconds, msg.sender);
    }

    /**
     * Gets subscriptions info from the subscriptions stored in this contract
     */
    function _getSubscription(bytes32 productId, address subscriber) internal view returns (Product storage p, TimeBasedSubscription storage s) {
        p = products[productId];
        require(p.id != 0x0, "error_notFound");
        s = p.subscriptions[subscriber];
    }

    function _isValid(TimeBasedSubscription storage s) internal view returns (bool) {
        return s.endTimestamp >= block.timestamp;  // solhint-disable-line not-rely-on-time
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

        (Product storage p,) = _getSubscription(productId, sender);
        require(msg.sender == p.pricingTokenAddress, "error_wrongPricingToken");

        address recipient = p.beneficiary;
        uint pricePerSecond = p.pricePerSecond;

        uint subscriptionSeconds = amount / pricePerSecond / 1 ether;
        _subscribe(productId, subscriptionSeconds, recipient);
    }


    // TODO: transfer allowance to another Marketplace contract
    // Mechanism basically is that this Marketplace draws from the allowance and credits
    //   the account on another Marketplace; OR that there is a central credit pool (say, an ERC20 token)
    // Creating another ERC20 token for this could be a simple fix: it would need the ability to transfer allowances

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
		require(msg.sender == pendingOwner, "onlyPendingOwner");
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

    /**
     * Allow the marketplace owner to create products for others.
     * This enables the marketplace owner to (manually) migrate products from old (mainnet) Marketplace to the new one(s).
     */
    function ownerCreateProduct(bytes32 id, string memory name, address beneficiary, uint pricePerSecond, address pricingToken, uint minimumSubscriptionSeconds, address productOwner) public onlyOwner{
        _createProduct(id, name, productOwner, beneficiary, pricePerSecond, pricingToken, minimumSubscriptionSeconds, false);
    }
}
