// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolExitPolicy {
    function setParam(uint256 param) external;
    function onPoolExit(address delegator, uint256 amount) external;
}
