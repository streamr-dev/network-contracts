// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolYieldPolicy {
    function setParam(uint256 param) external;
    function onUnstake(uint256 amount) external;
}
