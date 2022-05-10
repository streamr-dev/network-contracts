// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IJoinPolicy.sol";
import "../Bounty.sol";

import "hardhat/console.sol";

contract MaxAmountBrokersJoinPolicy is IJoinPolicy, Bounty {
    // event Joining(string indexed streamID, address indexed broker);

    struct LocalStorage {
        uint256 maxBrokers;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.MaximumBrokersJoinPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 maxBrokers) external {
        localData().maxBrokers = maxBrokers;
    }

    function checkAbleToJoin(address /*broker*/, uint256 /*amount*/) external view returns (bool) {

        // console.log("maxBrokers checkabletojoin", globalData().brokerCount);

        require(globalData().brokerCount + 1 <= localData().maxBrokers, "error_tooManyBrokers");
        return true;

        // if (stakedWei[broker] < minimumStakeWei) {
        //     uint missingStakeWei = minimumStakeWei - stakedWei[broker];
        //     // require(token.transferFrom(msg.sender, address(this), missingStakeWei), "error_transfer");
        //     _stake(broker, missingStakeWei);
        // }

        // min, max number of brokers

        // min stake
    }

//     function join(address broker, uint amount) external returns (bool) {
//         console.log("DefaultJoinPolicy.join()");
//         stakedWei[broker] += value;
//         console.log("stakedWei[broker] += value;", stakedWei[broker], minStake);
//         require(stakedWei[broker] >= minStake);
//         brokerCount += 1;
//         require(brokerCount >= minBrokers);
//         // if (brokers[broker] == 0) {
//         //     console.log("Adding broker ", broker, " amount ", amount);
//         //     brokers.push(broker);
//         // }
//         return true;

//         // if (stakedWei[broker] < minimumStakeWei) {
//         //     uint missingStakeWei = minimumStakeWei - stakedWei[broker];
//         //     // require(token.transferFrom(msg.sender, address(this), missingStakeWei), "error_transfer");
//         //     _stake(broker, missingStakeWei);
//         // }

//         // min, max number of brokers

//         // min stake
//     }
}