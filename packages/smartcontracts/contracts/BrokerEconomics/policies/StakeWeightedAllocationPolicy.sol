// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract StakeWeightedAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 incomePerSecond; // wei, total income velocity, distributed to brokers
        uint256 incomePerSecondPerStake; // wei, time-income per stake FULL TOKEN unit (wei x 1e18)
        uint256 cumulativeWeiPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)

        // the cumulative allocation (wei / full token stake) of each broker is calculated as
        //   cumulativeWeiPerStake common to all brokers - cumulativeReference for this broker
        // reference point is reset when stake changes because that's when the broker specific allocation velocity changes
        mapping(address => uint256) cumulativeReference;
        mapping(address => uint256) preReferenceWei; // allocations before the reference reset

        // TODO: delete this
        // mapping(address => uint256) stakedWei; // staked during last update: must remember this because allocations are based on stakes during update period

        // when the current unallocated funds will ru n out if more sponsorship is not added; OR when insolvency started
        // uint256 solventUntilTimestamp;
        uint256 defaultedWei; // lost income during the current insolvency; reported in InsolvencyEnded event, not used in allocations
        uint256 defaultedWeiPerStake; // lost cumulativeWeiPerStake during the current insolvency; reported in InsolvencyEnded event, not used in allocations

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
        // console.log("Setting incomePerSecond to", incomePerSecond);
        update(0);
        localData().incomePerSecond = incomePerSecond;
        update(0);
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeWeiPerStake
     * New funds that may have entered in the meanwhile are only counted after
     * This should be called BEFORE changes that affect incomePerSecondPerStake, such as total staked, incomePerSecond
     * insolvencyStartTimeOverride is needed when stake was increased before update, because insolvency must be calculated with the stake
     */
    function update(uint insolvencyStartTimeOverride) private {
        LocalStorage storage local = localData();
        GlobalStorage storage global = globalData();
        uint oldBalanceWei = local.lastUpdateBalance;
        uint newBalanceWei = global.unallocatedFunds;
        // console.log("    oldBalanceWei =", oldBalanceWei);
        // console.log("    newBalanceWei =", newBalanceWei);
        require(oldBalanceWei <= newBalanceWei, "error_allocationLost"); // unallocated funds should never decrease outside this function

        if (local.incomePerSecond > 0) {
            uint deltaTime = block.timestamp - local.lastUpdateTimestamp;
            // console.log("    update period = ", local.lastUpdateTimestamp, block.timestamp);

            // was solvent in the start => calculate the past update period until insolvency if any
            if (local.defaultedWei == 0) {
                uint allocationWeiPerStake = local.incomePerSecondPerStake * deltaTime;
                uint allocationWei = allocationWeiPerStake * local.lastUpdateTotalStake / 1e18; // "stake" is in full tokens
                // console.log("    total staked  = ", local.lastUpdateTotalStake);
                // console.log("    allocation    = ", allocationWei);

                // in case of insolvency: allocate all remaining funds (according to weights) up to the start of insolvency
                if (oldBalanceWei < allocationWei) {
                    uint insolvencyStartTime = insolvencyStartTimeOverride > 0 ? insolvencyStartTimeOverride : getInsolvencyTimestamp();
                    // console.log("    insolvcyStart = ", insolvencyStartTime);
                    uint insolvencySeconds = block.timestamp - insolvencyStartTime;
                    // console.log("    insolvcySec.s = ", insolvencySeconds);
                    assert(insolvencySeconds <= deltaTime); // equality means insolvency started exactly during the last update
                    local.defaultedWeiPerStake = insolvencySeconds * local.incomePerSecondPerStake;
                    local.defaultedWei = allocationWei - oldBalanceWei; // allocation should be >, otherwise insolvencyStartTime was wrong
                    // console.log("    deflt / stake = ", local.defaultedWeiPerStake);
                    // console.log("    defaulted     = ", local.defaultedWei);

                    allocationWei = oldBalanceWei;
                    allocationWeiPerStake = oldBalanceWei * 1e18 / local.lastUpdateTotalStake;

                    // InsolvencyStarted is not emitted if unallocatedFunds goes to exactly zero even if newBalanceWei also ends up zero.
                    // This is to give a "benefit of doubt" to the bounty: perhaps in the same block, a top-up still arrives,
                    //   and then emitting insolvency events would be spurious.
                    // The insolvency will be signalled only once update is called when there's non-zero allocations that aren't covered.
                    emit InsolvencyStarted(insolvencyStartTime);
                }

                oldBalanceWei -= allocationWei;
                newBalanceWei -= allocationWei;
                global.unallocatedFunds = newBalanceWei;
                local.cumulativeWeiPerStake += allocationWeiPerStake;
                // console.log("    newBalanceWei <-", newBalanceWei);
                // console.log("    cumulat. / st <-", local.cumulativeWeiPerStake);
            } else {
                local.defaultedWeiPerStake += local.incomePerSecondPerStake * deltaTime;
                local.defaultedWei += local.incomePerSecond * deltaTime;
                // console.log("    income per st = ", local.incomePerSecondPerStake);
                // console.log("    deflt / stake = ", local.defaultedWeiPerStake);
                // console.log("    defaulted     = ", local.defaultedWei);
            }

            // has been insolvent but now has funds again => back to normal
            //   don't distribute anything yet but start counting again
            if (local.defaultedWei > 0 && newBalanceWei > 0) {
                emit InsolvencyEnded(block.timestamp, local.defaultedWeiPerStake, local.defaultedWei);
                local.defaultedWeiPerStake = 0;
                local.defaultedWei = 0;
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

        // console.log("  incomePerSecondPerStake <-", local.incomePerSecondPerStake);
    }

    /** Horizon means how long time the (unallocated) funds are going to still last */
    function getInsolvencyTimestamp() public override(IAllocationPolicy) view returns (uint256) {
        uint unallocatedFunds = globalData().unallocatedFunds;
        if (unallocatedFunds == 0) { return 0; }
        uint incomePerSecond = localData().incomePerSecond;
        if (incomePerSecond == 0) { return 2**255; } // indefinitely solvent

        return localData().lastUpdateTimestamp + unallocatedFunds / incomePerSecond;
    }

    /** When broker joins, the current reference point is reset, and later the broker's allocation can be measured from the accumulated difference */
    function onJoin(address broker) external {
        // console.log("onJoin", broker);
        update(0);
        localData().cumulativeReference[broker] = localData().cumulativeWeiPerStake;
        // localData().stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("  cumulative reference <-", localData().cumulativeReference[broker]);
    }

    /** When broker leaves, its allocations so far are saved so that they continue to increase after next join */
    function onLeave(address broker) external {
        // console.log("onLeave", broker);
        update(0);
        // all allocations are paid out when leaving in the Bounty.sol:_removeBroker currently
        localData().preReferenceWei[broker] = 0;
        // localData().stakedWei[broker] = globalData().stakedWei[broker];
    }

    /**
     * When stake changes, reset the reference point
     */
    function onStakeIncrease(address broker, uint newStakeWei) external {
        LocalStorage storage local = localData();
        // console.log("onStakeIncrease", broker);
        update(0);

        // update pre-reset allocations
        // NB: can't use calculateAllocation(), must use pre-increase stake for the past period
        uint oldStakeWei = globalData().stakedWei[broker] - newStakeWei;
        uint brokerWeiPerStake = local.cumulativeWeiPerStake - local.cumulativeReference[broker];
        uint newAllocationsWei = oldStakeWei * brokerWeiPerStake / 1e18; // stake full token = 1e18 stake wei
        local.preReferenceWei[broker] += newAllocationsWei;

        // reset reference point
        local.cumulativeReference[broker] = local.cumulativeWeiPerStake;

        // local.stakedWei[broker] = globalData().stakedWei[broker];
        // console.log("  pre-reset allocation <-", local.preReferenceWei[broker]);
        // console.log("  cumulative reference <-", local.cumulativeReference[broker]);
    }

    function onSponsor(address, uint amount) external {
        // console.log("onSponsor, now got", globalData().unallocatedFunds);

        // in case the bounty was previously insolvent, now it got a top-up => return from insolvency
        uint oldUnallocatedFunds = globalData().unallocatedFunds - amount;
        uint oldInsolvencyTimestamp = localData().lastUpdateTimestamp + oldUnallocatedFunds / localData().incomePerSecond;
        // console.log("  onSponsor compare", oldInsolvencyTimestamp, block.timestamp);
        if (oldInsolvencyTimestamp <= block.timestamp) {  // update needs to be done even in the equality case
            update(oldInsolvencyTimestamp);
        }

        // Would be nice to avoid the above full update when tokens come in. Attempting in this branch (TODO: remove these comments if it works :)
        // Seems that by using solventUntilTimestamp instead of calculating solvency when needed, we need a full update()
        //   otherwise lastUpdateBalance is not updated and this line breaks:
        //       oldBalanceWei -= allocationWei;
        //   the reason is: lastUpdateBalance might be very old, before this top-up, and hence not enough to cover the allocation,
        //   yet clearly there is enough unallocated funds to cover when this top-up is included.
        // The timing on this top-up matters as to if the bounty becomes insolvent for a time before the top-up or not,
        //   this is another reason why not only solventUntilTimestamp but also lastUpdateBalance would need updating here,
        //   or at least a check whether the bounty went insolvent before this top-up or not; but that's not far from doing the full update()
    }

    /** Calculate the cumulative earnings per unit (full token stake) right now */
    function getCumulativeWeiPerStake() internal view returns(uint256) {
        // in the state of insolvency: don't allocate new earnings
        if (localData().lastUpdateBalance == 0) {
            return localData().cumulativeWeiPerStake;
        }

        // working as normal: allocate what is owed
        uint deltaTime = block.timestamp - localData().lastUpdateTimestamp;
        uint owedWeiPerStake = localData().incomePerSecondPerStake * deltaTime;
        uint owedWei = owedWeiPerStake * localData().lastUpdateTotalStake / 1e18;
        uint remainingWei = localData().lastUpdateBalance;
        if (owedWei <= remainingWei) {
            return localData().cumulativeWeiPerStake + owedWeiPerStake;
        }

        // gone insolvent since last update: allocate all remaining funds
        uint perStakeWei = remainingWei * 1e18 / localData().lastUpdateTotalStake;
        return localData().cumulativeWeiPerStake + perStakeWei;
    }

    // this works if stakedWei hasn't change since update() was last called
    function calculateAllocation(address broker) public view returns (uint allocation) {
        if (globalData().stakedWei[broker] == 0) { return 0; }

        // console.log("Calculate allocation for", broker);
        // console.log("  cumulative ", getCumulativeWeiPerStake());
        // console.log("  reference  ", localData().cumulativeReference[broker]);
        uint weiPerStake = getCumulativeWeiPerStake() - localData().cumulativeReference[broker];
        // console.log("  alloc / full token", weiPerStake);
        uint postReferenceWei = globalData().stakedWei[broker] * weiPerStake / 1e18; // full token = 1e18 wei
        // console.log("  preReferenceWei", localData().preReferenceWei[broker]);
        // console.log("  allocation ", postReferenceWei);
        return localData().preReferenceWei[broker] + postReferenceWei;
    }
}