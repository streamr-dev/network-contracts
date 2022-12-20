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

    // project events
    event ProjectPurchased(bytes32 productId, address subscriber, uint256 subscriptionSeconds, uint256 price, uint256 fee);
   
    // txFee events
    event TxFeeChanged(uint256 indexed newTxFee);

    // admin functionality events
    event Halted();
    event Resumed();

    function buy(bytes32 productId, uint subscriptionSeconds) external;

    function buyFor(bytes32 productId, uint subscriptionSeconds, address recipient) external;
}
