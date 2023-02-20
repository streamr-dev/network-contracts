// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IJoinPolicy.sol";
import "../Bounty.sol";

contract BrokerPoolOnlyJoinPolicy is IJoinPolicy, Bounty {
    function setParam(uint256) external {
    }

    // only BrokerPool contracts that were deployed using our own BrokerPoolFactory are allowed to join
    // solc-ignore-next-line func-mutability
    function onJoin(address broker, uint256) external {
        require(IFactory(globalData().streamrConstants.brokerPoolFactory()).deploymentTimestamp(broker) > 0, "error_onlyBrokerPools");
    }
}
