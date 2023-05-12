// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IDelegationPolicy {
    function setParam(uint256 initialMargin, uint256 minimumMarginFraction) external;

    /** @return allowedToJoin must be 0 for false, or 1 for true */
    function canJoin(address delegator) external view returns (uint allowedToJoin);
}
