// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface ILeavePolicy {
    function setParam(uint param) external;
    function getLeavePenaltyWei(address operator) external view returns (uint leavePenaltyWei);
}
