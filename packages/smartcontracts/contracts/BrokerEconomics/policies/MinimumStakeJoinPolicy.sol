// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "./IJoinPolicy.sol";
import "hardhat/console.sol";
import "../Bounty.sol";



contract MinimumStakeJoinPolicy is IJoinPolicy, Bounty {

    struct LocalStorage {
        uint256 minimumStake;
    }

    function localData() internal pure returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256("agreement.storage.MinimumStakeJoinPolicy");
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 minimumStake) external {
        localData().minimumStake = minimumStake;
    }

    function checkAbleToJoin(address broker, uint256 amount) external view returns (bool) {

        console.log("minimumStake checkabletojoin", globalData().stakedWei[broker], localData().minimumStake);

        require(globalData().stakedWei[broker] + amount >= localData().minimumStake);
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