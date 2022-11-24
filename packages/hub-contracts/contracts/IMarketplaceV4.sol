// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IMarketplaceV4 {
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

    event SubscriptionImported(bytes32 indexed productId, address indexed subscriber, uint endTimestamp);
    event SubscriptionTransferred(bytes32 indexed productId, address indexed from, address indexed to, uint secondsTransferred);

    // txFee events
    event TxFeeChanged(uint256 indexed newTxFee);

    // admin functionality events
    event Halted();
    event Resumed();

    function buy(bytes32 productId, uint subscriptionSeconds) external;

    function buyFor(bytes32 productId, uint subscriptionSeconds, address recipient) external;
}
