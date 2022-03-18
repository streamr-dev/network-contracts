// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "./IJoinPolicy.sol";
import "hardhat/console.sol";


contract DefaultJoinPolicy is IJoinPolicy {
    // event Joining(string indexed streamID, address indexed broker);
    uint value;
    bytes data;
    uint minStake;
    uint minAmountBrokers;
    uint minBrokers;
    uint public brokersCount;
    State public state;
    mapping(address => uint) public stakedWei;

     enum State {
        Closed,     // horizon < minHorizon and brokerCount fallen below minBrokerCount
        Warning,    // brokerCount > minBrokerCount, but horizon < minHorizon ==> brokers can leave without penalty
        Funded,     // horizon > minHorizon, but brokerCount still below minBrokerCount
        Running     // horizon > minHorizon and minBrokerCount <= brokerCount <= maxBrokerCount
    }


    function join(address broker, uint amount) external returns (bool) {
        console.log("DefaultJoinPolicy.join()");
        stakedWei[broker] += value;
        console.log("stakedWei[broker] += value;", stakedWei[broker], minStake);
        require(stakedWei[broker] >= minStake);
        brokersCount += 1;
        require(brokersCount >= minBrokers);
        // if (brokers[broker] == 0) {
        //     console.log("Adding broker ", broker, " amount ", amount);
        //     brokers.push(broker);
        // }
        return true;

        // if (stakedWei[broker] < minimumStakeWei) {
        //     uint missingStakeWei = minimumStakeWei - stakedWei[broker];
        //     // require(token.transferFrom(msg.sender, address(this), missingStakeWei), "error_transfer");
        //     _stake(broker, missingStakeWei);
        // }

        // min, max number of brokers

        // min stake
    }
}