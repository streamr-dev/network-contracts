// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IJoinPolicy.sol";
import "hardhat/console.sol";
import "../Bounty.sol";


contract MinimumStakeJoinPolicy is IJoinPolicy, Bounty {

    struct LocalStorage {
        uint256 minimumStake;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.MinimumStakeJoinPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 minimumStake) external {
        localData().minimumStake = minimumStake;
    }

    function checkAbleToJoin(address broker, uint256 amount) external view returns (bool) {

        console.log("minimumStake checkabletojoin", globalData().stakedWei[broker], localData().minimumStake);

        require(globalData().stakedWei[broker] + amount >= localData().minimumStake, "error_minimum_stake");
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