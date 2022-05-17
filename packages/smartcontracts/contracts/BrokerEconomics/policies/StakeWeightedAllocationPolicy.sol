// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract StakeWeightedAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 incomePerSecond; // wei, total income velocity, distributed to brokers
        uint256 incomePerSecondPerStake; // wei, time-income per stake FULL TOKEN unit (wei x 1e18)
        uint256 cumulativeEarningsPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)
        mapping(address => uint256) cumulativeEarningsAtJoin;
        mapping(address => uint256) unpaidEarningsWei;
        mapping(address => uint256) stakedWei; // staked during last update: must remember this because allocations are based on stakes during update period

        // when the current unallocated funds will run out if more sponsorship is not added; OR when insolvency started
        uint256 solventUntilTimestamp;
        uint256 forfeitedWei; // lost income during the current insolvency
        uint256 forfeitedWeiPerStake; // lost cumulativeEarningsPerStake during the current insolvency

        // allocation inputs in the beginning of the currently running update period
        //   explicitly stored in the end of last update() because they will be the primary inputs to next update()
        // it's important to call the update() when things that affect allocation change (like incomePerSecond or stakedWei)
        uint256 lastUpdateTimestamp;
        uint256 lastUpdateBalance;
        uint256 lastUpdateTotalStake;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.StakeWeightedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 incomePerSecond) external {
        update();
        localData().incomePerSecond = incomePerSecond;
        update();
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeEarningsPerStake
     * New funds that may have entered in the meanwhile are only counted after
     * This should be called BEFORE changes that affect incomePerSecondPerStake (total staked, earnings velocity) which is that "slope of the cumulative earnings curve"
     * TODO: to handle returning from insolvency immediately, this should also be called during _sponsor in main contract
     */
    function update() private {
        LocalStorage storage local = localData();
        GlobalState storage global = globalData();
        uint oldBalanceWei = local.lastUpdateBalance;
        uint newBalanceWei = global.unallocatedFunds;
        require(oldBalanceWei <= newBalanceWei, "error_allocationLost"); // unallocated funds should never decrease outside this function

            // console.log("    update period = ", localData().lastUpdateTimestamp, block.timestamp);
        if (local.incomePerSecond > 0) {
            uint insolvencyStartTime = local.solventUntilTimestamp;
            uint deltaTime = block.timestamp - local.lastUpdateTimestamp;

            // was solvent in the start => calculate the past update period until insolvency if any
            if (oldBalanceWei > 0) {
                // console.log("    total staked  = ", localData().lastUpdateTotalStake);
                // console.log("    allocation    = ", allocationWei);
                uint allocationWeiPerStake = local.incomePerSecondPerStake * deltaTime;
                uint allocationWei = allocationWeiPerStake * local.lastUpdateTotalStake / 1e18; // "stake" is in full tokens

                // in case of insolvency: allocate all remaining funds (according to weights) up to the start of insolvency
                if (block.timestamp > insolvencyStartTime) {
                    uint insolvencySeconds = block.timestamp - insolvencyStartTime;
                    assert(insolvencyStartTime > block.timestamp - deltaTime); // because there still were tokens during last update
                    local.forfeitedWeiPerStake = insolvencySeconds * local.incomePerSecondPerStake;
                    local.forfeitedWei = allocationWei - oldBalanceWei; // allocation should be >, otherwise insolvencyStartTime was wrong

                    allocationWei = oldBalanceWei;
                    allocationWeiPerStake = oldBalanceWei * 1e18 / local.lastUpdateTotalStake;

                    emit InsolvencyStarted(insolvencyStartTime);
                    // console.log(" !> insolvcyStart = ", insolvencyStartTime);
                }

                oldBalanceWei -= allocationWei;
                newBalanceWei -= allocationWei;
                global.unallocatedFunds = newBalanceWei;
                local.cumulativeEarningsPerStake += allocationWeiPerStake;
            } else {
                // console.log("    income per st = ", localData().incomePerSecondPerStake);
                // console.log("    forf / stake  = ", localData().forfeitedWeiPerStake);
                // console.log("    forfeited     = ", localData().forfeitedWei);
                local.forfeitedWeiPerStake += local.incomePerSecondPerStake * deltaTime;
                local.forfeitedWei += local.incomePerSecond * deltaTime;
            }

            // has been insolvent but now has funds again => back to normal
            //   don't distribute anything yet but start counting again
            if (local.forfeitedWei > 0 && newBalanceWei > 0) {
                emit InsolvencyEnded(insolvencyStartTime, block.timestamp, local.forfeitedWeiPerStake, local.forfeitedWei);
                local.forfeitedWeiPerStake = 0;
                local.forfeitedWei = 0;
            }
        }

        // adjust income velocity for a possibly changed number of brokers
        uint totalStakedWei = global.totalStakedWei;
        if (totalStakedWei > 0) {
            local.incomePerSecondPerStake = local.incomePerSecond * 1e18 / totalStakedWei;
        } else {
            local.incomePerSecondPerStake = 0;
        }

        // these will be used for the next update period calculation
        local.lastUpdateTimestamp = block.timestamp;
        local.lastUpdateTotalStake = totalStakedWei;
        local.lastUpdateBalance = newBalanceWei;

        if (newBalanceWei > 0) {
            if (local.incomePerSecondPerStake > 0) {
                assert(totalStakedWei > 0); // because `totalStakedWei == 0` => `incomePerSecondPerStake == 0`
                local.solventUntilTimestamp = block.timestamp + newBalanceWei * 1e18 / totalStakedWei / local.incomePerSecondPerStake;
            } else {
                local.solventUntilTimestamp = 2**255; // indefinitely solvent
            }
        }

        // console.log("    incomePerSecondPerStake <-", localData().incomePerSecondPerStake);
        // console.log("    solventUntilTimestamp <-", localData().solventUntilTimestamp);
    }

    /** Horizon means how long time the (unallocated) funds are going to still last */
    function getHorizonSeconds() public override(IAllocationPolicy) view returns (uint256) {
        if (localData().solventUntilTimestamp < block.timestamp) {
            return 0;
        }
        return localData().solventUntilTimestamp - block.timestamp;
    }

    /** When broker joins, the current "water level" is saved and later its allocation can be measured from the difference */
    function onJoin(address broker) external {
        update();
        localData().cumulativeEarningsAtJoin[broker] = localData().cumulativeEarningsPerStake;
        localData().stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("onJoin", broker);
        // console.log("  cme at join <-", localData().cumulativeEarningsAtJoin[broker]);
    }

    /** When broker leaves, its allocations so far are saved so that they continue to increase after next join */
    function onLeave(address broker) external {
        update();
        // all earnings are paid out when leaving in the Bounty.sol:_removeBroker currently
        localData().unpaidEarningsWei[broker] = 0;
        localData().stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("onLeave", broker);
        // console.log("  earnings before join <-", localData().earningsBeforeJoinWei[broker]);
    }

    /**
     * When stake changes, effectively do a leave + join, resetting the CE for this broker
     */
    function onStakeIncrease(address broker) external {
        update();
        localData().unpaidEarningsWei[broker] = calculateAllocation(broker);
        localData().cumulativeEarningsAtJoin[broker] = localData().cumulativeEarningsPerStake;
        localData().stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("onStakeIncrease", broker);
        // console.log("  earnings before join <-", localData().earningsBeforeJoinWei[broker]);
        // console.log("  cme at join <-", localData().cumulativeEarningsAtJoin[broker]);
    }

    function onSponsor(address, uint) external {
        // in case the bounty was previously insolvent, now it got a top-up => return from insolvency
        if (localData().solventUntilTimestamp < block.timestamp) {
            update();
        }
    }

    /** Calculate the cumulative earnings per unit (full token stake) right now */
    function getCumulativeEarnings() internal view returns(uint256) {
        // in the state of insolvency: don't allocate new earnings
        if (localData().lastUpdateBalance == 0) {
            return localData().cumulativeEarningsPerStake;
        }

        // working as normal: allocate what is owed
        uint deltaTime = block.timestamp - localData().lastUpdateTimestamp;
        uint owedWeiPerStake = localData().incomePerSecondPerStake * deltaTime;
        uint owedWei = owedWeiPerStake * localData().lastUpdateTotalStake / 1e18;
        uint remainingWei = localData().lastUpdateBalance;
        if (owedWei <= remainingWei) {
            return localData().cumulativeEarningsPerStake + owedWeiPerStake;
        }

        // gone insolvent since last update: allocate all remaining funds
        uint perStakeWei = remainingWei * 1e18 / localData().lastUpdateTotalStake;
        return localData().cumulativeEarningsPerStake + perStakeWei;
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
        // console.log("  unpaidEarningsWei", localData().unpaidEarningsWei[broker]);
        // console.log("  earningsAfterJoinWei", earningsAfterJoinWei);
        return localData().unpaidEarningsWei[broker] + earningsAfterJoinWei;
    }
}