// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IAllocationPolicy {
    function setParam(uint param) external;
    function getEarningsWei(address operator) external view returns (uint earningsWei);
    function getInsolvencyTimestamp() external view returns (uint insolvencyTimestamp);
    function onJoin(address operator) external;
    function onLeave(address operator) external;
    function onWithdraw(address operator) external returns (uint payoutWei);
    function onStakeChange(address operator, int stakeChangeWei) external;
    function onSponsor(address sponsor, uint amountWei) external;
}
