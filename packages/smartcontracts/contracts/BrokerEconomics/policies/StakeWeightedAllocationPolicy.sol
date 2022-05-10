// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract StakeWeightedAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 horizon;
        uint256 incomePerSecond; // wei, total income velocity, distributed to brokers
        uint256 incomePerSecondPerStake; // wei, time-income per stake FULL TOKEN unit (wei x 1e18)
        uint256 cumulativeEarningsPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)
        mapping(address => uint256) cumulativeEarningsAtJoin;
        mapping(address => uint256) earningsBeforeJoinWei;
        mapping(address => uint256) stakedWei; // staked during last update: must remember this because allocations are based on stakes during update period
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

    /** Horizon means how long time the (unallocated) funds are going to still last */
    function getHorizonSeconds() public override(IAllocationPolicy) view returns (uint256) {
        // console.log("    horizon: bounty income wei / sec", localData().incomePerSecond);
        if (localData().incomePerSecond == 0) {
            return 2**256 - 1; // max uint256
        }
        uint owedWeiPerStake = owedPerStakeSinceLastUpdate();
        // console.log("    horizon: bounty owed wei / stake", owedWeiPerStake);
        uint owedWei = owedWeiPerStake * localData().lastUpdateTotalStake / 1e18;
        uint remainingWei = globalData().unallocatedFunds;
        // console.log("    horizon: bounty remaining unallocated wei", remainingWei);
        if (remainingWei < owedWei) { return 0; }
        return (remainingWei - owedWei) / localData().incomePerSecond;
    }

    /** When broker joins, the current "water level" is saved and later its allocation can be measured from the difference */
    function onJoin(address broker) external {
        updateCumulativeEarnings();
        localData().cumulativeEarningsAtJoin[broker] = localData().cumulativeEarningsPerStake;
        localData().stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("onJoin", broker);
        // console.log("  cme at join <-", localData().cumulativeEarningsAtJoin[broker]);
    }

    /** When broker leaves, its allocations so far are saved so that they continue to increase after next join */
    function onLeave(address broker) external {
        updateCumulativeEarnings();
        localData().earningsBeforeJoinWei[broker] = calculateAllocation(broker);
        localData().stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("onLeave", broker);
        // console.log("  earnings before join <-", localData().earningsBeforeJoinWei[broker]);
    }

    /**
     * When stake changes, effectively do a leave + join, resetting the CE for this broker
     */
    function onStakeIncrease(address broker) external {
        updateCumulativeEarnings();
        localData().earningsBeforeJoinWei[broker] = calculateAllocation(broker);
        localData().cumulativeEarningsAtJoin[broker] = localData().cumulativeEarningsPerStake;
        localData().stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("onStakeIncrease", broker);
        // console.log("  earnings before join <-", localData().earningsBeforeJoinWei[broker]);
        // console.log("  cme at join <-", localData().cumulativeEarningsAtJoin[broker]);
    }

    /** Calculate earnings owed since last update, assuming normal operation */
    function owedPerStakeSinceLastUpdate() internal view returns(uint256 deltaEarnings) {
        uint deltaTime = block.timestamp - localData().lastUpdateTimestamp;
        // console.log("    time          = ", block.timestamp, localData().lastUpdateTimestamp);
        deltaEarnings = localData().incomePerSecondPerStake * deltaTime;
        // console.log("    deltaEarnings = ", deltaEarnings);
    }

    /** Calculate the cumulative earnings per unit (full token stake) right now */
    function getCumulativeEarnings() internal view returns(uint256) {
        // in the state of insolvency: don't allocate new earnings
        if (localData().lastUpdateBalance == 0) {
            return localData().cumulativeEarningsPerStake;
        }

        // working as normal: allocate what is owed
        uint owedWeiPerStake = owedPerStakeSinceLastUpdate();
        uint owedWei = owedWeiPerStake * localData().lastUpdateTotalStake / 1e18;
        uint remainingWei = globalData().unallocatedFunds;
        if (owedWei <= remainingWei) {
            return localData().cumulativeEarningsPerStake + owedWeiPerStake;
        }

        // gone insolvent since last update: allocate all remaining funds
        uint perStakeWei = remainingWei * 1e18 / localData().lastUpdateTotalStake;
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
        // console.log("    owedWei       = ", owedWei);

        if (wasSolvent) {
            uint solventUntilTimestamp = block.timestamp; // normally: solvent until the end of the update period i.e. now
            uint remainingWei = globalData().unallocatedFunds;
            // console.log("    remainingWei  = ", remainingWei);
            if (owedWei <= remainingWei) {
                // solvent: allocate out all owed earnings
                remainingWei -= owedWei;
                // console.log("normal allocation", owedWei);
                localData().cumulativeEarningsPerStake += owedWeiPerStake;
            } else {
                // in case of insolvency: allocate all remaining funds according to weight up to the start of insolvency
                // console.log("partial allocation", remainingWei);
                uint forfeitedWei = owedWei - remainingWei;
                // console.log("    forfeitedWei  = ", forfeitedWei);
                // console.log("    time          = ", block.timestamp, localData().lastUpdateTimestamp);
                uint deltaTime = block.timestamp - localData().lastUpdateTimestamp;
                uint insolvencyStartTime = block.timestamp - deltaTime * forfeitedWei / owedWei;
                // console.log("    insolvcyStart = ", insolvencyStartTime);
                uint perStakeWei = remainingWei * 1e18 / localData().lastUpdateTotalStake;

                solventUntilTimestamp = insolvencyStartTime;

                remainingWei = 0;
                localData().cumulativeEarningsPerStake += perStakeWei;
            }
            // console.log("    remainingWei  = ", remainingWei);
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
        // console.log("    updateCumulativeEarnings done, incomePerSecondPerStake <-", localData().incomePerSecondPerStake);
    }

    function calculateAllocation(address broker) public view returns (uint allocation) {
        // never joined
        if (globalData().joinTimeOfBroker[broker] == 0) { return 0; }

        // TODO: what is this check about? Don't give earnings for brokers younger than horizon? Why?
        // if (globalData().joinTimeOfBroker[broker] + localData().horizon > block.timestamp) {
        //     return localData().earningsBeforeJoinWei[broker];
        // }

        // console.log("Calculate allocation for", broker);
        // console.log("  cumulative earnings ", getCumulativeEarnings());
        // console.log("  cumulat. e. at join ", localData().cumulativeEarningsAtJoin[broker]);
        uint earningsPerFullToken = getCumulativeEarnings() - localData().cumulativeEarningsAtJoin[broker];
        // console.log("  earningsPerFullToken", earningsPerFullToken);
        uint earningsAfterJoinWei = localData().stakedWei[broker] * earningsPerFullToken / 1e18;
        // console.log("  earningsBeforeJoinWei", localData().earningsBeforeJoinWei[broker]);
        // console.log("  earningsAfterJoinWei", earningsAfterJoinWei);
        return localData().earningsBeforeJoinWei[broker] + earningsAfterJoinWei;
    }
}