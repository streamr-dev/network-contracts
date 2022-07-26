// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolJoinPolicy.sol";
import "../BrokerPool.sol";
import "hardhat/console.sol";
contract DefaultPoolJoinPolicy is IPoolJoinPolicy, BrokerPool {

    function setParam(uint256 param) external {
        console.log("DefaultPoolJoinPolicy.setParam", param);
    }

    function onPoolJoin(address delegator, uint256 amount) external returns (uint256 amountPoolTokens){
        console.log("DefaultPoolJoinPolicy.onPoolJoin", delegator, amount);
        // constant function, one DATA = one pool token
        return amount * 2;
    }
}