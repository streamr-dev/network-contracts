// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IMarketplace {
    enum ProductState {
        NotDeployed,                // non-existent or deleted
        Deployed                    // created or redeployed
    }

    enum WhitelistState{
        None,
        Pending,
        Approved,
        Rejected
    }

    function createProduct(
        bytes32 id,
        string memory name,
        address beneficiary,
        uint pricePerSecond,
        address pricingTokenAddress,
        uint minimumSubscriptionSeconds
    ) external;

    function getStablecoinAddress() external view returns (address);
    function setStablecoinAddress(address _stablecoin) external;

    // product events
    event ProductCreated(address indexed owner, bytes32 indexed id, string name, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds);
    event ProductUpdated(address indexed owner, bytes32 indexed id, string name, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds);
    event ProductDeleted(address indexed owner, bytes32 indexed id, string name, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds);
    event ProductImported(address indexed owner, bytes32 indexed id, string name, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds);
    event ProductRedeployed(address indexed owner, bytes32 indexed id, string name, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds);
    event ProductOwnershipOffered(address indexed owner, bytes32 indexed id, address indexed to);
    event ProductOwnershipChanged(address indexed newOwner, bytes32 indexed id, address indexed oldOwner);

    // subscription events
    event Subscribed(bytes32 indexed productId, address indexed subscriber, uint endTimestamp);
    event NewSubscription(bytes32 indexed productId, address indexed subscriber, uint endTimestamp);
    event SubscriptionExtended(bytes32 indexed productId, address indexed subscriber, uint endTimestamp);
    event SubscriptionImported(bytes32 indexed productId, address indexed subscriber, uint endTimestamp);
    event SubscriptionTransferred(bytes32 indexed productId, address indexed from, address indexed to, uint secondsTransferred);

    // whitelist events
    event WhitelistRequested(bytes32 indexed productId, address indexed subscriber);
    event WhitelistApproved(bytes32 indexed productId, address indexed subscriber);
    event WhitelistRejected(bytes32 indexed productId, address indexed subscriber);
    event WhitelistEnabled(bytes32 indexed productId);
    event WhitelistDisabled(bytes32 indexed productId);

    // txFee events
    event TxFeeChanged(uint256 indexed newTxFee);

    // admin functionality events
    event Halted();
    event Resumed();

    function getSubscription(bytes32 productId, address subscriber) external view returns (bool isValid, uint endTimestamp);
    function hasValidSubscription(bytes32 productId, address subscriber) external view returns (bool isValid);

    function getProduct(bytes32 id) external view returns (string memory name, address owner, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds, ProductState state, bool requiresWhitelist);

    function buy(bytes32 productId, uint subscriptionSeconds) external;

    function buyFor(bytes32 productId, uint subscriptionSeconds, address recipient) external;
}