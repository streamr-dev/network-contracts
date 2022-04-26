// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../policies/IAllocationPolicy.sol";
import "../Bounty.sol";


contract TestAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 horizon;
        uint256 earningsWeiPerSecond;
        uint256 cumulativeEarningsPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)
        mapping(address => uint256) cumulativeEarningsAtJoin;
        mapping(address => uint256) earningsBeforeJoinWei;
        uint256 lastUpdateTimestamp;
        // mapping(address => uint256) earningsForMember;
        // uint256 distributedEarnings;
        // uint256 earningsToBeDistributed;
        uint256 incomePerSecondPerStake; // time-income per stake FULL TOKEN unit (wei x 1e18)
        // uint256 cumulativeEarningsPerStake;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.StakeWeightedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 earningsWeiPerSecond) external {
        if (earningsWeiPerSecond == 1) {
            require(false, "test-error: setting param allocation policy");
        }
    }

    function onJoin(address broker) external {
        require(false, "test-error: onjoin allocation policy");
    }

    function onLeave(address broker) external {
        updateCumulativeEarnings();
        // TODO: could this be left out? CE shouldn't be invalidated I think
        // localData().cumulativeEarningsAtJoin[broker] = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
        localData().earningsBeforeJoinWei[broker] = calculateAllocation(broker);
    }

    /**
     * When stake changes, effectively do a leave + join, resetting the CE for this broker
     */
    function onStakeIncrease(address broker) external {
        updateCumulativeEarnings();
        localData().earningsBeforeJoinWei[broker] = calculateAllocation(broker);
        localData().cumulativeEarningsAtJoin[broker] = localData().cumulativeEarningsPerStake;
    }

    /** Calculate the cumulative earnings per unit (full token stake) right now */
    function getCumulativeEarnings() internal view returns(uint256) {
        uint deltaTime = block.timestamp - localData().lastUpdateTimestamp;
        uint deltaEarnings = localData().incomePerSecondPerStake * deltaTime;
        return localData().cumulativeEarningsPerStake + deltaEarnings;
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeEarningsPerStake
     * This should be called before/during changes that affect incomePerSecondPerStake (total staked, earnings velocity) which is that "slope of the cumulative earnings curve"
     */
    function updateCumulativeEarnings() private {
        localData().cumulativeEarningsPerStake = getCumulativeEarnings();
        localData().lastUpdateTimestamp = block.timestamp;

        if (globalData().totalStakedWei > 0) {
            localData().incomePerSecondPerStake = localData().earningsWeiPerSecond * 1e18 / globalData().totalStakedWei;
        } else {
            localData().incomePerSecondPerStake = 0;
        }
        console.log("updateCumulativeEarnings, incomePerSecondPerStake: ", localData().incomePerSecondPerStake);
    }

    function calculateAllocation(address broker) public view returns (uint allocation) {
        // never joined
        if (globalData().joinTimeOfBroker[broker] == 0) { return 0; }

        // TODO: what is this check about? Don't give earnings for brokers younger than horizon? Why?
        if (globalData().joinTimeOfBroker[broker] + localData().horizon > block.timestamp) {
            return localData().earningsBeforeJoinWei[broker];
        }

        uint earningsPerFullToken = getCumulativeEarnings() - localData().cumulativeEarningsAtJoin[broker];
        uint earningsAfterJoinWei = globalData().stakedWei[broker] * earningsPerFullToken / 1e18;
        return localData().earningsBeforeJoinWei[broker] + earningsAfterJoinWei;
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