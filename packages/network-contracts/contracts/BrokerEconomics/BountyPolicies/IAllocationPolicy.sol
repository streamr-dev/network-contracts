// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IAllocationPolicy {
    function setParam(uint param) external;
    function calculateAllocation(address broker) external view returns (uint allocation);
    function getInsolvencyTimestamp() external view returns (uint insolvencyTimestamp);
    function onJoin(address broker) external;
    function onLeave(address broker) external;
    function onWithdraw(address broker) external returns (uint payoutWei);
    function onStakeChange(address broker, int stakeChangeWei) external;
    function onSponsor(address sponsor, uint amountWei) external;
}
