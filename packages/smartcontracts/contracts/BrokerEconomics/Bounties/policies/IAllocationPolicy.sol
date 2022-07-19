// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IAllocationPolicy {
    function setParam(uint param) external;
    function calculateAllocation(address broker) external returns (uint allocation);
    function getInsolvencyTimestamp() external view returns (uint insolvencyTimestamp);
    function onJoin(address broker) external;
    function onLeave(address broker) external;
    function onWithdraw(address broker) external returns (uint payoutWei);
    function onStakeIncrease(address broker, uint amountWei) external;
    function onSponsor(address sponsor, uint amountWei) external;
}
