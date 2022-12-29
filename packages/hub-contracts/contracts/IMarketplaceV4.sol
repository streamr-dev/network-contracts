// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IMarketplaceV4 {
    // project events
    event ProjectPurchased(bytes32 projectId, address subscriber, uint256 subscriptionSeconds, uint256 price, uint256 fee);
   
    // txFee events
    event TxFeeChanged(uint256 indexed newTxFee);

    // admin functionality events
    event Halted();
    event Resumed();

    function buy(bytes32 projectId, uint subscriptionSeconds) external;
    function buyFor(bytes32 projectId, uint subscriptionSeconds, address recipient) external;
}
