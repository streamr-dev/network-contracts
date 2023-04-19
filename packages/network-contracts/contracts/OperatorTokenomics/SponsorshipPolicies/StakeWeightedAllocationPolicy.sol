// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Sponsorship.sol";

// import "hardhat/console.sol";

// allocation happens over time, so there's lots of "time relying here"
/* solhint-disable not-rely-on-time */

/**
 * @dev note: ...perStake variables are per FULL TOKEN stake for numerical precision reasons, internally.
 *   Don't ever expose them outside! We don't want to deal with non-standard "full tokens", e.g. USDC has 6 decimals instead of 18
 * Detailed reason: if incomePerSecondPerStake were per stake-wei, then because stake typically is greater than the payout in one second,
 *   the quotient would always be zero.
 * Example: 1 DATA/second, 1000 DATA staked:
 *   - incomePerSecondPerStake(wei) would be 1e18 / 1000e18 < 1, which becomes zero
 *   - incomePerSecondPerStake(token) however is 1e18 / 1000 = 1e15, which is fine
 * Sanity check: There's order of 1e9 of DATA full tokens in existence, and one year is 3e7 seconds, so the precision is good enough
 *   for the case where ALL data is staked on a sponsorship that pays 1 DATA/year
 */
contract StakeWeightedAllocationPolicy is IAllocationPolicy, Sponsorship {
    struct LocalStorage {
        uint256 incomePerSecond; // wei, total income velocity, distributed to operators
        uint256 incomePerSecondPerStake; // wei, time-income per stake FULL TOKEN unit (wei x 1e18)
        uint256 cumulativeWeiPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)

        // the cumulative allocation (wei / full token stake) of each operator is calculated as
        //   cumulativeWeiPerStake (common to all operators) minus cumulativeReference (for this operator)
        // the reference point is reset when stake changes because that's when the operator specific allocation velocity changes
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
        bytes32 storagePosition = keccak256(abi.encodePacked("sponsorship.storage.StakeWeightedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint256 incomePerSecond) external {
        // console.log("Setting incomePerSecond to", incomePerSecond);
        update(0); // TODO: not needed if setParam can't be called again
        localData().incomePerSecond = incomePerSecond;
        update(0); // TODO: not needed if setParam can't be called again
    }

    function getEarningsWei(address operator) public view returns (uint earningsWei) {
        if (stakedWei[operator] == 0) { return 0; }
        return _calculateAllocation(operator, stakedWei[operator]);
    }

    /**
     * Calculate the operator's allocation from the cumulative earnings per unit (full token stake) right now
     * It's important that stakedWei hasn't changed since update() was last called
     * TODO: see if there's some way to DRY out common parts with update(), they both do solvency and allocation calculations
     */
    function _calculateAllocation(address operator, uint stakeWei) internal view returns (uint allocation) {
        // console.log("Calculate allocation for", operator);
        LocalStorage storage local = localData();

        // in the state of insolvency or not running: use the old cumulativeWeiPerStake, don't allocate new earnings
        uint cumulativeWeiPerStake = local.cumulativeWeiPerStake;

        // if it WAS working normally during last update: try to allocate what is owed
        if (local.lastUpdateWasRunning && unallocatedWei > 0) {
            uint deltaTime = block.timestamp - local.lastUpdateTimestamp;
            uint owedWeiPerStake = local.incomePerSecondPerStake * deltaTime;
            uint owedWei = owedWeiPerStake * local.lastUpdateTotalStake / 1e18;
            uint remainingWeiPerStake = unallocatedWei * 1e18 / local.lastUpdateTotalStake;

            // if it went insolvent after the last update: allocate all remaining funds, otherwise allocate what is owed
            cumulativeWeiPerStake += owedWei > unallocatedWei ? remainingWeiPerStake : owedWeiPerStake;
        }
        // console.log("  cumulative ", cumulativeWeiPerStake);
        // console.log("  reference  ", localData().cumulativeReference[operator]);
        uint weiPerStake = cumulativeWeiPerStake - localData().cumulativeReference[operator];
        // console.log("  alloc / full token", weiPerStake);
        uint allocationSinceReferenceResetWei = stakeWei * weiPerStake / 1e18; // full token = 1e18 wei
        // console.log("  onReferenceResetWei  ", localData().onReferenceResetWei[operator]);
        // console.log("  since reference reset", allocationSinceReferenceResetWei);
        return localData().onReferenceResetWei[operator] + allocationSinceReferenceResetWei;
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeWeiPerStake
     * New funds that may have entered in the meanwhile are only counted after
     * This should be called BEFORE changes that affect incomePerSecondPerStake, such as total staked, incomePerSecond
     * insolvencyStartTimeOverride is needed when stake was increased before update, because insolvency must be calculated with the stake
     * TODO: maybe split update into updateAllocations and updateIncomes / prepareUpdate
     *       that might also get rid of lastUpdateTotalStake and lastUpdateWasRunning
     *         after changing the order of change and listener in Sponsorship->onJoin, like was done for onSponsor
     * TODO: try to DRY out common parts with _calculateAllocation()
     */
    function update(uint newFundsWei) private {
        LocalStorage storage localVars = localData();
        if (localVars.lastUpdateWasRunning) {
            uint deltaTime = block.timestamp - localVars.lastUpdateTimestamp;
            // console.log("    lastUpdateTimestamp", localVars.lastUpdateTimestamp, "block.timestamp", block.timestamp);
            // was solvent in the start => calculate the past update period until insolvency if any
            if (localVars.defaultedWei == 0) {
                uint allocationWei = localVars.incomePerSecond * deltaTime;
                uint allocationWeiPerStake = localVars.incomePerSecondPerStake * deltaTime;
                // in case of insolvency: allocate all remaining funds (according to weights) up to the start of insolvency
                if (unallocatedWei < allocationWei) {
                    uint insolvencyStartTime = getInsolvencyTimestamp();
                    uint insolvencySeconds = block.timestamp - insolvencyStartTime;
                    assert(insolvencySeconds <= deltaTime); // equality means insolvency started exactly during the last update
                    localVars.defaultedWeiPerStake = insolvencySeconds * localVars.incomePerSecondPerStake;
                    localVars.defaultedWei = allocationWei - unallocatedWei; // allocation should be >, otherwise insolvencyStartTime was wrong

                    allocationWei = unallocatedWei;
                    allocationWeiPerStake = unallocatedWei * 1e18 / localVars.lastUpdateTotalStake;

                    // InsolvencyStarted is not emitted if unallocatedWei goes to exactly zero even if newBalanceWei also ends up zero.
                    // This is to give a "benefit of doubt" to the sponsorship: perhaps in the same block, a top-up still arrives,
                    //   and then emitting insolvency events would be spurious.
                    // The insolvency will be signalled only once update is called when there's non-zero earnings that aren't covered.
                    emit InsolvencyStarted(insolvencyStartTime);
                }
                // move funds from unallocated to allocated
                unallocatedWei -= allocationWei;
                localVars.cumulativeWeiPerStake += allocationWeiPerStake;
                // console.log("    allocationWei", allocationWei, "allocationWeiPerStake", allocationWeiPerStake);
            } else {
                localVars.defaultedWeiPerStake += localVars.incomePerSecondPerStake * deltaTime;
                localVars.defaultedWei += localVars.incomePerSecond * deltaTime;
            }
            // has been insolvent but now has funds again => back to normal
            //   don't distribute anything yet but start counting again
            if (localVars.defaultedWei > 0 && newFundsWei > 0) {
                emit InsolvencyEnded(block.timestamp, localVars.defaultedWeiPerStake, localVars.defaultedWei);
                localVars.defaultedWeiPerStake = 0;
                localVars.defaultedWei = 0;
            }
        }
        // save values for next update: adjust income velocity for a possibly changed number of operators
        uint totalStakedWei = totalStakedWei;
        if (totalStakedWei > 0) {
            localVars.incomePerSecondPerStake = localVars.incomePerSecond * 1e18 / totalStakedWei;
        } // else { local.incomePerSecondPerStake = 0; } // never used currently
        localVars.lastUpdateTimestamp = block.timestamp;
        localVars.lastUpdateTotalStake = totalStakedWei;
        localVars.lastUpdateWasRunning = isRunning();
    }

    /** Horizon means how long time the (unallocated) funds are going to still last */
    function getInsolvencyTimestamp() public override(IAllocationPolicy) view returns (uint256 insolvencyTimestamp) {
        // uint unallocatedWei = unallocatedWei;
        // if (unallocatedWei == 0) { return 0; }
        uint incomePerSecond = localData().incomePerSecond;
        if (incomePerSecond == 0) { return 2**255; } // indefinitely solvent

        return localData().lastUpdateTimestamp + unallocatedWei / incomePerSecond;
    }

    /** When operator joins, the current reference point is reset, and later the operator's allocation can be measured from the accumulated difference */
    function onJoin(address operator) external {
        // console.log("onJoin update", operator);
        update(0);
        localData().cumulativeReference[operator] = localData().cumulativeWeiPerStake;
        // console.log("  cumulative reference <-", localData().cumulativeReference[operator]);
    }

    /** When operator leaves, its state is cleared as if it had never joined */
    function onLeave(address operator) external {
        // console.log("onLeave update", operator);
        update(0);
        delete localData().onReferenceResetWei[operator];
        delete localData().cumulativeReference[operator];
    }

    /**
     * When stake changes, reset the reference point
     */
    function onStakeChange(address operator, int stakeChangeWei) external {
        LocalStorage storage local = localData();
        // console.log("onStakeChange", operator, stakedWei[operator]);
        // console.logInt(stakeChangeWei);
        update(0);

        // must use pre-increase stake for the past period => undo the stakeChangeWei just for the calculation
        uint oldStakeWei = uint(int(stakedWei[operator]) - stakeChangeWei);

        // reset reference point
        local.onReferenceResetWei[operator] = _calculateAllocation(operator, oldStakeWei);
        local.cumulativeReference[operator] = local.cumulativeWeiPerStake;

        // console.log("  pre-reset allocation <-", local.onReferenceResetWei[operator]);
        // console.log("  cumulative reference <-", local.cumulativeReference[operator]);
    }

    /** @return payoutWei how many tokens to send out from Sponsorship */
    function onWithdraw(address operator) external returns (uint payoutWei) {
        // console.log("onWithdraw", operator);
        update(0);

        // calculate payout FIRST, before zeroing the allocation onReferenceReset
        payoutWei = getEarningsWei(operator);

        // reset reference point, also zero the "unpaid earnings" because they will be paid out
        LocalStorage storage local = localData();
        local.cumulativeReference[operator] = local.cumulativeWeiPerStake;
        local.onReferenceResetWei[operator] = 0;
    }

    function onSponsor(address, uint amount) external {
        // console.log("onSponsor: had before", unallocatedWei);
        // console.log("           got more  ", amount);

        // in case the sponsorship had gone insolvent, now it got a top-up => return from insolvency
        if (getInsolvencyTimestamp() < block.timestamp) {
            update(amount);
        }
        emit ProjectedInsolvencyUpdate(getInsolvencyTimestamp());
    }
}
