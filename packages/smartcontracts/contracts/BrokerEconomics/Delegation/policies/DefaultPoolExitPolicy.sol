// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolExitPolicy.sol";
import "../BrokerPool.sol";
import "hardhat/console.sol";
contract DefaultPoolExitPolicy is IPoolExitPolicy, BrokerPool {

    function setParam(uint256 param) external {
        console.log("DefaultPoolExitPolicy.setParam", param);
    }

    function onPoolExit(address delegator, uint256 amount) external {
        console.log("DefaultPoolExitPolicy.onPoolExit", delegator, amount);
    }
}