// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface ILeavePolicy {
    function setParam(uint256 param) external;
    function getLeavePenaltyWei(address operator) external view returns (uint leavePenaltyWei);
}
