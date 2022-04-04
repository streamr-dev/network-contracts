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

    function calculateAllocation(address broker) external returns (uint allocation) {
        if (globalData().joinTimeOfBroker[broker] + localData().horizon > block.timestamp) {
            uint allocationpart = globalData().totalStakedWei / globalData().stakedWei[broker];
            return globalData().unallocatedFunds * allocationpart;
        } else {
            return 0;
        }
    }
}