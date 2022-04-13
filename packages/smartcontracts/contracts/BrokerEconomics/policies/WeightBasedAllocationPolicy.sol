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
        uint256 timeLastJoinOrLeft;
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
        localData().weiPerSecond = 10;

    }

    function onJoin(address broker) external {
        // x timelastjoin
        // y cumulativememberearnings
        // t slope earningsPerMemberPerSecond

        updateCME();
        localData().cmeOnJoin[broker] = localData().cumulativeMemberEarnings;
    }

    function onLeft(address broker) external {
        updateCME();
        localData().cmeOnJoin[broker] = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    }

    function updateCME() private {
        uint deltaCME = localData().earningsPerMemberPerSecond * (block.timestamp - localData().timeLastJoinOrLeft);
        localData().cumulativeMemberEarnings += deltaCME;
        localData().timeLastJoinOrLeft = block.timestamp;
        if (globalData().brokersCount > 0) {
            localData().earningsPerMemberPerSecond = localData().weiPerSecond / globalData().brokersCount;
        } else {
            localData().earningsPerMemberPerSecond = 0;
        }
        console.log("updateCME, earningsPerMemberPerSecond: ", localData().earningsPerMemberPerSecond);
    }

    function calculateAllocation(address broker) external view returns (uint allocation) {
        // uint currentTime = block.timestamp;
        // console.log("calculateAllocation ", globalData().joinTimeOfBroker[broker], localData().horizon, block.timestamp);
        if (globalData().joinTimeOfBroker[broker] != 0 && 
            globalData().joinTimeOfBroker[broker] + localData().horizon <= block.timestamp) {
            // console.log("calculateAllocation ", globalData().joinTimeOfBroker[broker], localData().horizon, block.timestamp);
        //     console.log("c1", globalData().totalStakedWei, globalData().stakedWei[broker]);
        //     uint allocationpart = globalData().totalStakedWei / globalData().stakedWei[broker];
        //     console.log("calc ", globalData().totalStakedWei, globalData().stakedWei[broker], globalData().unallocatedFunds * allocationpart);
        //     console.log("returning", globalData().unallocatedFunds * allocationpart);
        //     return globalData().unallocatedFunds * allocationpart;
            // console.log("getAllocation blocktime", block.timestamp);
            // if (currentTime - localData().timeLastJoinOrLeft == 0) {
            //     currentTime += 1;
            // }
            uint currentCME = localData().earningsPerMemberPerSecond * (block.timestamp - localData().timeLastJoinOrLeft) + localData().cumulativeMemberEarnings;
            console.log("calculateAllocation ", localData().earningsPerMemberPerSecond, block.timestamp - localData().timeLastJoinOrLeft, localData().cmeOnJoin[broker]);
            return currentCME - localData().cmeOnJoin[broker];
        } else {
            return 0;
        }
    }

    function calculatePenaltyOnStake(address broker) external view returns (uint256 stake) {
        console.log("calculatePenaltyOnStake ", globalData().joinTimeOfBroker[broker], localData().horizon, block.timestamp);
        if (block.timestamp < globalData().joinTimeOfBroker[broker] + localData().horizon) {
            return globalData().stakedWei[broker] / 10;
        } else {
            return 0;
        }
    }
}