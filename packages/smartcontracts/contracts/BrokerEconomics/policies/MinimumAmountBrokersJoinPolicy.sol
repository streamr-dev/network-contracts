// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "./IJoinPolicy.sol";
import "hardhat/console.sol";
import "../Bounty.sol";



contract MinimumAmountBrokersJoinPolicy is IJoinPolicy, Bounty {
    // event Joining(string indexed streamID, address indexed broker);

    struct LocalStorage {
        uint256 minBrokers;
    }

    function localData() internal pure returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256("agreement.storage.MinimumAmountBrokersJoinPolicy");
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 minBrokers) external {
        localData().minBrokers = minBrokers;
    }

    function checkAbleToJoin(address broker, uint256 amount) external view returns (bool) {

        console.log("minimumBrokers checkabletojoin", globalData().brokersCount);

        require(globalData().brokersCount + 1 >= localData().minBrokers);
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
//         brokersCount += 1;
//         require(brokersCount >= minBrokers);
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