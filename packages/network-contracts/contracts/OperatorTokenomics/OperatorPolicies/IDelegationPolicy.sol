// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IDelegationPolicy {
    function setParam(uint param) external;

    /** can throw to prevent delegation. Gets called AFTER the pool token minting */
    function onDelegate(address delegator) external;
}
