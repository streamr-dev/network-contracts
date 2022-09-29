// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

/**
 * @dev note: ...perStake variables are per FULL TOKEN stake for numerical precision reasons, internally.
 *   Don't ever expose them outside! We don't want to deal with non-standard "full tokens", e.g. USDC has 6 decimals instead of 18
 * Detailed reason: if incomePerSecondPerStake were per stake-wei, then because stake typically is greater than the payout in one second,
 *   the quotient would always be zero.
 * Example: 1 DATA/second, 1000 DATA staked:
 *   - incomePerSecondPerStake(wei) would be 1e18 / 1000e18 < 1, which becomes zero
 *   - incomePerSecondPerStake(token) however is 1e18 / 1000 = 1e15, which is fine
 * Sanity check: There's order of 1e9 of DATA full tokens in existence, and one year is 3e7 seconds, so the precision is good enough
 *   for the case where ALL data is staked on a bounty that pays 1 DATA/year
 */
contract StakeWeightedAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        uint256 incomePerSecond; // wei, total income velocity, distributed to brokers
        uint256 incomePerSecondPerStake; // wei, time-income per stake FULL TOKEN unit (wei x 1e18)
        uint256 cumulativeWeiPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)

        // the cumulative allocation (wei / full token stake) of each broker is calculated as
        //   cumulativeWeiPerStake (common to all brokers) minus cumulativeReference (for this broker)
        // the reference point is reset when stake changes because that's when the broker specific allocation velocity changes
        mapping(address => uint256) cumulativeReference;
        mapping(address => uint256) onReferenceResetWei; // allocations before the reference reset

        // when the current unallocated funds will run out if more sponsorship is not added; OR when insolvency started
        uint256 defaultedWei; // lost income during the current insolvency; reported in InsolvencyEnded event, not used in allocations
        uint256 defaultedWeiPerStake; // lost cumulativeWeiPerStake during the current insolvency; reported in InsolvencyEnded event, not used in allocations

        // allocation inputs in the beginning of the currently running update period
        //   explicitly stored in the end of last update() because they will be the primary inputs to next update()
        // it's important to call the update() when things that affect allocation change (like incomePerSecond or stakedWei)
        uint256 lastUpdateTimestamp;
        uint256 lastUpdateTotalStake;
        bool lastUpdateWasRunning;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.StakeWeightedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 incomePerSecond) external {
        // console.log("Setting incomePerSecond to", incomePerSecond);
        update(0); // TODO: not needed if setParam can't be called again
        localData().incomePerSecond = incomePerSecond;
        update(0); // TODO: not needed if setParam can't be called again
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeWeiPerStake
     * New funds that may have entered in the meanwhile are only counted after
     * This should be called BEFORE changes that affect incomePerSecondPerStake, such as total staked, incomePerSecond
     * insolvencyStartTimeOverride is needed when stake was increased before update, because insolvency must be calculated with the stake
     * TODO: split update into updateAllocations and updateIncomes / prepareUpdate
     *       that might also get rid of lastUpdateTotalStake and lastUpdateWasRunning
     *         after changing the order of change and listener in Bounty->onJoin, like was done for onSponsor
     */
    function update(uint newFundsWei) private {
        LocalStorage storage local = localData();
        GlobalStorage storage global = globalData();

        if (local.lastUpdateWasRunning) {
            uint deltaTime = block.timestamp - local.lastUpdateTimestamp;
            // console.log("    update period = ", local.lastUpdateTimestamp, block.timestamp);

            // was solvent in the start => calculate the past update period until insolvency if any
            if (local.defaultedWei == 0) {
                uint allocationWei = local.incomePerSecond * deltaTime;
                uint allocationWeiPerStake = local.incomePerSecondPerStake * deltaTime;
                // console.log("    total staked  = ", local.lastUpdateTotalStake);
                // console.log("    allocation    = ", allocationWei);

                // in case of insolvency: allocate all remaining funds (according to weights) up to the start of insolvency
                if (global.unallocatedFunds < allocationWei) {
                    uint insolvencyStartTime = getInsolvencyTimestamp();
                    // console.log("    insolvcyStart = ", insolvencyStartTime);
                    uint insolvencySeconds = block.timestamp - insolvencyStartTime;
                    // console.log("    insolvcySec.s = ", insolvencySeconds);
                    assert(insolvencySeconds <= deltaTime); // equality means insolvency started exactly during the last update
                    local.defaultedWeiPerStake = insolvencySeconds * local.incomePerSecondPerStake;
                    local.defaultedWei = allocationWei - global.unallocatedFunds; // allocation should be >, otherwise insolvencyStartTime was wrong
                    // console.log("    deflt / stake = ", local.defaultedWeiPerStake);
                    // console.log("    defaulted     = ", local.defaultedWei);

                    allocationWei = global.unallocatedFunds;
                    allocationWeiPerStake = global.unallocatedFunds * 1e18 / local.lastUpdateTotalStake;

                    // InsolvencyStarted is not emitted if unallocatedFunds goes to exactly zero even if newBalanceWei also ends up zero.
                    // This is to give a "benefit of doubt" to the bounty: perhaps in the same block, a top-up still arrives,
                    //   and then emitting insolvency events would be spurious.
                    // The insolvency will be signalled only once update is called when there's non-zero allocations that aren't covered.
                    emit InsolvencyStarted(insolvencyStartTime);
                }

                // move funds from unallocated to allocated
                global.unallocatedFunds -= allocationWei;
                local.cumulativeWeiPerStake += allocationWeiPerStake;
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
            if (local.defaultedWei > 0 && newFundsWei > 0) {
                emit InsolvencyEnded(block.timestamp, local.defaultedWeiPerStake, local.defaultedWei);
                local.defaultedWeiPerStake = 0;
                local.defaultedWei = 0;
            }
        }

        // save values for next update: adjust income velocity for a possibly changed number of brokers
        uint totalStakedWei = global.totalStakedWei;
        if (totalStakedWei > 0) {
            local.incomePerSecondPerStake = local.incomePerSecond * 1e18 / totalStakedWei;
            // console.log("  incomePerSecondPerStake <-", local.incomePerSecondPerStake);
        } // else { local.incomePerSecondPerStake = 0; } // never used currently
        local.lastUpdateTimestamp = block.timestamp;
        local.lastUpdateTotalStake = totalStakedWei;
        local.lastUpdateWasRunning = isRunning();
        // console.log("Is running: ", local.lastUpdateWasRunning ? "yes" : "no");
    }

    /** Horizon means how long time the (unallocated) funds are going to still last */
    function getInsolvencyTimestamp() public override(IAllocationPolicy) view returns (uint256) {
        // uint unallocatedFunds = globalData().unallocatedFunds;
        // if (unallocatedFunds == 0) { return 0; }
        uint incomePerSecond = localData().incomePerSecond;
        if (incomePerSecond == 0) { return 2**255; } // indefinitely solvent

        return localData().lastUpdateTimestamp + globalData().unallocatedFunds / incomePerSecond;
    }

    /** When broker joins, the current reference point is reset, and later the broker's allocation can be measured from the accumulated difference */
    function onJoin(address broker) external {
        // console.log("onJoin", broker);
        update(0);
        localData().cumulativeReference[broker] = localData().cumulativeWeiPerStake;
        // console.log("  cumulative reference <-", localData().cumulativeReference[broker]);
    }

    /** When broker leaves, its allocations so far are saved so that they continue to increase after next join */
    function onLeave(address broker) external {
        // console.log("onLeave", broker);
        update(0);
        delete localData().onReferenceResetWei[broker];
        delete localData().cumulativeReference[broker];
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
        local.onReferenceResetWei[broker] += newAllocationsWei;

        // reset reference point
        local.cumulativeReference[broker] = local.cumulativeWeiPerStake;

        // console.log("  pre-reset allocation <-", local.onReferenceResetWei[broker]);
        // console.log("  cumulative reference <-", local.cumulativeReference[broker]);
    }

    // TODO: DRY out commonalities with onStakeIncrease
    function onWithdraw(address broker) external returns (uint payoutWei) {
        // console.log("onWithdraw", broker);
        update(0);

        payoutWei = calculateAllocation(broker);

        // reset reference point, also zero the "unpaid allocations" because they will be paid out
        LocalStorage storage local = localData();
        local.cumulativeReference[broker] = local.cumulativeWeiPerStake;
        local.onReferenceResetWei[broker] = 0;
    }

    function onSponsor(address, uint amount) external {
        // console.log("onSponsor: had before", globalData().unallocatedFunds);
        // console.log("           got more  ", amount);

        // in case the bounty had gone insolvent, now it got a top-up => return from insolvency
        if (getInsolvencyTimestamp() < block.timestamp) {
            update(amount);
        }
    }

    // TODO: DRY out this function by using it both in update and calculateAllocation
    // NOTE: this function uses "full token" units, hence don't expose it as public function!
    function getCumulativeWeiPerStake() internal view returns(uint256) {
        LocalStorage storage local = localData();

        // in the state of insolvency or not running: don't allocate new earnings
        uint remainingWei = globalData().unallocatedFunds;
        if (remainingWei == 0 || !local.lastUpdateWasRunning) {
            return local.cumulativeWeiPerStake;
        }

        // working as normal: allocate what is owed
        uint deltaTime = block.timestamp - local.lastUpdateTimestamp;
        uint owedWeiPerStake = local.incomePerSecondPerStake * deltaTime;
        uint owedWei = owedWeiPerStake * local.lastUpdateTotalStake / 1e18;
        if (owedWei <= remainingWei) {
            return local.cumulativeWeiPerStake + owedWeiPerStake;
        }

        // gone insolvent since last update: allocate all remaining funds
        uint perStakeWei = remainingWei * 1e18 / local.lastUpdateTotalStake;
        return local.cumulativeWeiPerStake + perStakeWei;
    }

    /**
     * Calculate the allocation in token-wei for the given broker
     * @dev It's important that stakedWei hasn't changed since update() was last called
     */
    function calculateAllocation(address broker) public view returns (uint allocation) {
        if (globalData().stakedWei[broker] == 0) { return 0; }

        // console.log("Calculate allocation for", broker);
        // console.log("  cumulative ", getCumulativeWeiPerStake());
        // console.log("  reference  ", localData().cumulativeReference[broker]);
        uint weiPerStake = getCumulativeWeiPerStake() - localData().cumulativeReference[broker];
        // console.log("  alloc / full token", weiPerStake);
        uint afterReferenceResetWei = globalData().stakedWei[broker] * weiPerStake / 1e18; // full token = 1e18 wei
        // console.log("  onReferenceResetWei", localData().onReferenceResetWei[broker]);
        // console.log("  allocation ", afterReferenceResetWei);
        return localData().onReferenceResetWei[broker] + afterReferenceResetWei;
    }
}