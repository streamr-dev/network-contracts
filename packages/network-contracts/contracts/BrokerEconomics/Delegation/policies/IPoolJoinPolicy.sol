// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolJoinPolicy {
    function setParam(uint256 initialMargin, uint256 minimumMarginPercent) external;
    function canJoin(address delegator) external view returns (uint allowedToJoin);
}
