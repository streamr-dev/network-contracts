// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Bounty.sol";


contract WeightBasedAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 horizon;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.WeightBasedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 horizon) external {
        localData().horizon = horizon;
    }

    function calculateAllocation(address broker) external view returns (uint allocation) {
        console.log("calculateAllocation ", globalData().joinTimeOfBroker[broker], localData().horizon, block.timestamp);
        if (globalData().joinTimeOfBroker[broker] + localData().horizon <= block.timestamp) {
            console.log("c1", globalData().totalStakedWei, globalData().stakedWei[broker]);
            uint allocationpart = globalData().totalStakedWei / globalData().stakedWei[broker];
            console.log("calc ", globalData().totalStakedWei, globalData().stakedWei[broker], globalData().unallocatedFunds * allocationpart);
            console.log("returning", globalData().unallocatedFunds * allocationpart);
            return globalData().unallocatedFunds * allocationpart;
        } else {
            return 0;
        }
    }
}