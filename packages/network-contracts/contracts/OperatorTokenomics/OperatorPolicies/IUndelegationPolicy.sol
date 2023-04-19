// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IUndelegationPolicy {
    function setParam(uint256 param) external;
    function onUndelegate(address delegator, uint256 amount) external;
}
