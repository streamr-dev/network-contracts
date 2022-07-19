// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolJoinPolicy.sol";
import "../BrokerPool.sol";
import "hardhat/console.sol";
contract DefaultJoinPolicy is IPoolJoinPolicy, BrokerPool {

    function setParam(uint256 param) external {
        console.log("DefaultJoinPolicy.setParam", param);
    }
}