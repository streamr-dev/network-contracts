// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolYieldPolicy.sol";
import "../BrokerPool.sol";
import "hardhat/console.sol";
contract DefaultPoolYieldPolicy is IPoolYieldPolicy, BrokerPool {

    function setParam(uint256 param) external {
        console.log("DefaultPoolYieldPolicy.setParam", param);
    }

    function onUnstake(uint256 amount) external {
        console.log("DefaultPoolYieldPolicy.onUnstake", amount);
    }
}