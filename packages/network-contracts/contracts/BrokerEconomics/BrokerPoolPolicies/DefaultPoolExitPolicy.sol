// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolExitPolicy.sol";
import "../BrokerPool.sol";

contract DefaultPoolExitPolicy is IPoolExitPolicy, BrokerPool {

    function setParam(uint256 param) external {
    }

    function onPoolExit(address delegator, uint256 amount) external {
        // TODO
    }
}