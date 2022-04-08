// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Bounty.sol";


contract WeightBasedAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 horizon;
        uint256 weiPerSecond;
        uint256 cumulativeMemberEarnings;
        mapping(address => uint256) cmeOnJoin;
        uint256 timeLastJoin;
        // mapping(address => uint256) earningsForMember;
        // uint256 distributedEarnings;
        // uint256 earningsToBeDistributed;
        uint256 earningsPerMemberPerSecond;
        // uint256 cumulativeMemberEarnings;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.WeightBasedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 horizon) external {
        localData().horizon = horizon;
        // TODO add these params to setter from bounty
        localData().weiPerSecond = 1;

    }

    function onJoin(address broker) external {
        // x timelastjoin
        // y cumulativememberearnings
        // t slope earningsPerMemberPerSecond

        localData().cmeOnJoin[broker] = localData().cumulativeMemberEarnings;
    
        uint newCME = localData().earningsPerMemberPerSecond * (block.timestamp - localData().timeLastJoin) + localData().cumulativeMemberEarnings;
        localData().cumulativeMemberEarnings = newCME;
        localData().timeLastJoin = block.timestamp;
        localData().earningsPerMemberPerSecond = localData().weiPerSecond / globalData().brokersCount;
    }

    function calculateAllocation(address broker) external view returns (uint allocation) {
        // console.log("calculateAllocation ", globalData().joinTimeOfBroker[broker], localData().horizon, block.timestamp);
        // if (globalData().joinTimeOfBroker[broker] + localData().horizon <= block.timestamp) {
        //     console.log("c1", globalData().totalStakedWei, globalData().stakedWei[broker]);
        //     uint allocationpart = globalData().totalStakedWei / globalData().stakedWei[broker];
        //     console.log("calc ", globalData().totalStakedWei, globalData().stakedWei[broker], globalData().unallocatedFunds * allocationpart);
        //     console.log("returning", globalData().unallocatedFunds * allocationpart);
        //     return globalData().unallocatedFunds * allocationpart;
        // } else {
        //     return 0;
        // }
        console.log("getAllocation blocktime", block.timestamp);
        uint additionalCME = localData().earningsPerMemberPerSecond * (block.timestamp - localData().timeLastJoin);
        return localData().cmeOnJoin[broker] + additionalCME;
    }

    function calculatePenaltyOnStake(address broker) external view returns (uint256 stake) {
        if (globalData().joinTimeOfBroker[broker] + localData().horizon <= block.timestamp) {
            return 0;
        } else {
            return globalData().stakedWei[broker] / 10;
        }
    }
}