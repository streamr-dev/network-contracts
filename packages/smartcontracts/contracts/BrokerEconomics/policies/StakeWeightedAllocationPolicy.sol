// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract StakeWeightedAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 horizon;
        uint256 incomePerSecond; // total income velocity, distributed to brokers
        uint256 incomePerSecondPerStake; // time-income per stake FULL TOKEN unit (wei x 1e18)
        uint256 cumulativeEarningsPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)
        mapping(address => uint256) cumulativeEarningsAtJoin;
        mapping(address => uint256) earningsBeforeJoinWei;
        uint256 lastUpdateTimestamp;
        uint256 lastUpdateBalance;
        uint256 lastUpdateTotalStake;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.StakeWeightedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 incomePerSecond) external {
        localData().incomePerSecond = incomePerSecond;
    }

    /** When broker joins, the current "water level" is saved and later its allocation can be measured from the difference */
    function onJoin(address broker) external {
        updateCumulativeEarnings();
        localData().cumulativeEarningsAtJoin[broker] = localData().cumulativeEarningsPerStake;
    }

    /** When broker leaves, its allocations so far are saved so that they continue to increase after next join */
    function onLeave(address broker) external {
        updateCumulativeEarnings();
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

    /** Calculate earnings owed since last update, assuming normal operation */
    function owedPerStakeSinceLastUpdate() internal view returns(uint256 deltaEarnings) {
        uint deltaTime = block.timestamp - localData().lastUpdateTimestamp;
        // console.log("deltaTime     = ", deltaTime);
        deltaEarnings = localData().incomePerSecondPerStake * deltaTime;
        // console.log("deltaEarnings = ", deltaEarnings);
    }

    /** Calculate the cumulative earnings per unit (full token stake) right now */
    function getCumulativeEarnings() internal view returns(uint256) {
        bool wasSolvent = localData().lastUpdateBalance > 0;
        if (!wasSolvent) {
            // in the state of insolvency
            return localData().cumulativeEarningsPerStake;
        }

        // working as normal
        uint owedWeiPerStake = owedPerStakeSinceLastUpdate();
        uint owedWei = owedWeiPerStake * globalData().totalStakedWei / 1e18;
        uint remainingWei = globalData().unallocatedFunds;
        if (owedWei <= remainingWei) {
            return localData().cumulativeEarningsPerStake + owedWeiPerStake;
        }

        // gone insolvent since last update
        uint perStakeWei = remainingWei * 1e18 / globalData().totalStakedWei;
        return localData().cumulativeEarningsPerStake + perStakeWei;
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeEarningsPerStake
     * This should be called BEFORE changes that affect incomePerSecondPerStake (total staked, earnings velocity) which is that "slope of the cumulative earnings curve"
     * TODO: to handle returning from insolvency immediately, this should also be called during _sponsor in main contract
     */
    function updateCumulativeEarnings() private {
        // this is the current stake that will be used for the next update, this update uses the last saved value
        uint totalStakedWei = globalData().totalStakedWei;
        // console.log("total staked now", globalData().totalStakedWei);

        bool wasSolvent = localData().lastUpdateBalance > 0;
        uint owedWeiPerStake = owedPerStakeSinceLastUpdate();
        uint owedWei = owedWeiPerStake * localData().lastUpdateTotalStake / 1e18; // "stake" is in full tokens
        // console.log("total staked  = ", localData().lastUpdateTotalStake);
        // console.log("owedWei       = ", owedWei);

        if (wasSolvent) {
            uint solventUntilTimestamp = block.timestamp; // normally: solvent until the end of the update period i.e. now
            uint remainingWei = globalData().unallocatedFunds;
            // console.log("remainingWei  =", remainingWei);
            if (owedWei <= remainingWei) {
                // solvent: allocate out all owed earnings
                remainingWei -= owedWei;
                // console.log("normal allocation", owedWei);
                localData().cumulativeEarningsPerStake += owedWeiPerStake;
            } else {
                // in case of insolvency: allocate all remaining funds according to weight up to the start of insolvency
                // console.log("partial allocation", remainingWei);
                uint forfeitedWei = owedWei - remainingWei;
                uint deltaTime = block.timestamp - localData().lastUpdateTimestamp;
                uint insolvencyStartTime = block.timestamp - deltaTime * forfeitedWei / owedWei;
                uint perStakeWei = remainingWei * 1e18 / localData().lastUpdateTotalStake;

                solventUntilTimestamp = insolvencyStartTime;

                remainingWei = 0;
                localData().cumulativeEarningsPerStake += perStakeWei;
            }
            globalData().unallocatedFunds = remainingWei;
            localData().lastUpdateBalance = remainingWei;
            localData().lastUpdateTotalStake = totalStakedWei;

            // in case of insolvency, time the "last update" to the start of the insolvency instead of "now",
            //   so the forfeit calculation at InsolvencyEnded works out correctly
            localData().lastUpdateTimestamp = solventUntilTimestamp;
            if (remainingWei == 0) {
                emit InsolvencyStarted(solventUntilTimestamp);
            }
        } else {
            uint newFundsWei = globalData().unallocatedFunds;
            if (newFundsWei > 0) {
                // back to normal: don't distribute anything yet but start counting again
                //   all owed funds are reported as "forfeited"
                emit InsolvencyEnded(localData().lastUpdateTimestamp, block.timestamp, owedWeiPerStake, owedWei);
                localData().lastUpdateTimestamp = block.timestamp;
                localData().lastUpdateBalance = newFundsWei;
                localData().lastUpdateTotalStake = totalStakedWei;
            }
        }

        // adjust income velocity for a possibly changed number of brokers
        if (totalStakedWei > 0) {
            localData().incomePerSecondPerStake = localData().incomePerSecond * 1e18 / totalStakedWei;
        } else {
            localData().incomePerSecondPerStake = 0;
        }
        console.log("updateCumulativeEarnings, incomePerSecondPerStake = ", localData().incomePerSecondPerStake);
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
        return 0;
        // console.log("calculatePenaltyOnStake ", globalData().joinTimeOfBroker[broker], localData().horizon, block.timestamp);
        // if (block.timestamp < globalData().joinTimeOfBroker[broker] + localData().horizon) {
        //     return globalData().stakedWei[broker] / 10;
        // } else {
        //     return 0;
        // }
    }
}