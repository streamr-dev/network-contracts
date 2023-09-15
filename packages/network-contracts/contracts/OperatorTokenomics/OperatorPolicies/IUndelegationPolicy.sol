// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IUndelegationPolicy {
    function setParam(uint param) external;

    /** can throw to prevent undelegation. Gets called BEFORE entering the undelegation queue */
    function onUndelegate(address delegator, uint amount) external;
}
