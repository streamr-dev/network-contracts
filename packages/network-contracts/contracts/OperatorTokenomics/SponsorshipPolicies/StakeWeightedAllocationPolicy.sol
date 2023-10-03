// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Sponsorship.sol";

import "hardhat/console.sol";

// allocation happens over time, so there's necessarily lots of "relying on time" here
/* solhint-disable not-rely-on-time */

contract StakeWeightedAllocationPolicy is IAllocationPolicy, Sponsorship {
    struct LocalStorage {
        uint incomePerSecond;           // wei, total income velocity, distributed to operators, decided by sponsor upon creation
        uint cumulativeWeiPer1e36Stake; // cumulative income over time, per 1e36 stake-wei, with added accuracy to avoid rounding to zero

        /**
         * The per-1e36-stake allocation (1e36 * new-earnings-wei / total-stake-wei) of each operator is
         *   the integral over time of incomePerSecond (divided by total stake), calculated as
         *   cumulativeWeiPer1e36Stake (upper limit, common to all operators) minus cumulativeReference (lower limit, just for this operator)
         * This reference point will be updated when stake changes because that's when the operator-specific allocation weight changes,
         *   so we save the result of the integral up to that point and continue integrating from there with the new weight.
         */
        mapping(address => uint) cumulativeReference;
        /** Remember how much earnings there were before the last cumulativeReference update */
        mapping(address => uint) earningsBeforeReferenceUpdate;

        // the current unallocated funds will run out if more sponsorship is not added
        uint defaultedWei; // lost income during the current insolvency; reported in InsolvencyEnded event, not used in allocations
        uint defaultedWeiPer1e36Stake; // lost cumulativeWeiPer1e36Stake during the current insolvency; reported in InsolvencyEnded event, not used in allocations

        // calculation inputs in the beginning of the currently running update period
        //   explicitly stored in the end of last update() because they will be the primary inputs to next update()
        // it's important to call the update() when things that affect allocation change (like incomePerSecond or stakedWei)
        uint lastUpdateTimestamp;
        uint lastUpdateTotalStake;
        uint lastUpdateRemainingWei;
        bool lastUpdateWasRunning;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("sponsorship.storage.StakeWeightedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint incomePerSecond) external {
        // update(); // only needed if setParam can be called again to re-set the incomePerSecond
        localData().incomePerSecond = incomePerSecond;
        // update(); // only needed if setParam can be called again to re-set the incomePerSecond
    }

    /** @return earningsWei the current earnings of the given operator (since last withdraw) */
    function getEarningsWei(address operator) public view returns (uint earningsWei) {
        if (stakedWei[operator] == 0) { return 0; }
        LocalStorage storage local = localData();
        (uint newAllocationsWei,) = calculateSinceLastUpdate();
        uint cumulativeWeiPer1e36Stake = local.cumulativeWeiPer1e36Stake + newAllocationsWei * 1e36 / local.lastUpdateTotalStake;
        uint newEarningsPer1e36Stake = cumulativeWeiPer1e36Stake - localData().cumulativeReference[operator];
        console.log("getEarningsWei", cumulativeWeiPer1e36Stake, newEarningsPer1e36Stake);
        console.log(localData().earningsBeforeReferenceUpdate[operator], stakedWei[operator], stakedWei[operator] * newEarningsPer1e36Stake / 1e36,
            localData().earningsBeforeReferenceUpdate[operator] + stakedWei[operator] * newEarningsPer1e36Stake / 1e36);
        // TODO: smarter rounding? If the remainder is less than what's possible with incomePerSecond wei-precision, then round up
        return localData().earningsBeforeReferenceUpdate[operator] + stakedWei[operator] * newEarningsPer1e36Stake / 1e36;
    }

    /**
     * Figure out the allocations since last time update() was called
     * This is used for updating but also for "real-time" earnings queries and insolvency projection
     * @param newAllocationsWei how many tokens have been allocated to operators since last time update() was called
     * @param newDefaultsWei how many tokens have been lost to insolvency since last time update() was called
     **/
    function calculateSinceLastUpdate() private view returns (uint newAllocationsWei, uint newDefaultsWei) {
        LocalStorage storage localVars = localData();

        // not enough operators: don't allocate at all
        if (!localVars.lastUpdateWasRunning) { return (0, 0); }

        uint deltaTime = block.timestamp - localVars.lastUpdateTimestamp;
        uint owedWei = localVars.incomePerSecond * deltaTime;

        // tokens run out: allocate all remaining funds
        uint tokensLeft = localVars.lastUpdateRemainingWei;
        if (tokensLeft < owedWei) {
            return (tokensLeft, owedWei - tokensLeft);
        }

        // happy path: we have enough tokens => allocate what is owed, nothing defaulted
        return (owedWei, 0);
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeWeiPer1e36Stake
     * New funds that may have entered in the meanwhile are only counted towards the next update,
     *   so they appear the have arrived after this update() call.
     */
    function update() private {
        LocalStorage storage localVars = localData();
        (uint newAllocationsWei, uint newDefaultsWei) = calculateSinceLastUpdate();

        // in case of insolvency: allocate all remaining funds (according to weights) up to the start of insolvency
        // NOTE: Insolvency won't start if remainingWei goes to exactly zero. This is to give a "benefit of doubt" to the sponsorship:
        //   perhaps in the same block, a top-up still arrives, and then emitting insolvency events would be spurious.
        // The insolvency only starts once update is called when there's non-zero allocations that aren't covered.
        if (newDefaultsWei > 0) {
            if (localVars.defaultedWei == 0) { // was previously still solvent (had not defaulted yet)
                emit InsolvencyStarted(getInsolvencyTimestamp());
            }
            localVars.defaultedWei += newDefaultsWei;
            localVars.defaultedWeiPer1e36Stake += newDefaultsWei * 1e36 / localVars.lastUpdateTotalStake;
        }

        if (newAllocationsWei > 0) {
            // move funds from sponsorship to earnings, add to the cumulativeWeiPer1e36Stake integral
            console.log("update", newAllocationsWei, localVars.lastUpdateTotalStake);
            earningsWei += newAllocationsWei;
            remainingWei -= newAllocationsWei;
            localVars.cumulativeWeiPer1e36Stake += newAllocationsWei * 1e36 / localVars.lastUpdateTotalStake;
        }

        // save values for next update: adjust income velocity for a possibly changed number of operators
        localVars.lastUpdateTimestamp = block.timestamp;
        localVars.lastUpdateRemainingWei = remainingWei;
        localVars.lastUpdateTotalStake = totalStakedWei;
        localVars.lastUpdateWasRunning = isRunning();
    }

    /** @return insolvencyTimestamp when the sponsorship would run out */
    function getInsolvencyTimestamp() public override(IAllocationPolicy) view returns (uint insolvencyTimestamp) {
        LocalStorage storage localVars = localData();
        if (localVars.incomePerSecond == 0) { return 2**255; } // indefinitely solvent

        return localVars.lastUpdateTimestamp + localVars.lastUpdateRemainingWei / localVars.incomePerSecond;
    }

    /** When operator joins, the current reference point is reset, and later the operator's allocation can be measured from the accumulated difference */
    function onJoin(address operator) external {
        update();
        localData().cumulativeReference[operator] = localData().cumulativeWeiPer1e36Stake;
    }

    /** When operator leaves, its state is cleared as if it had never joined */
    function onLeave(address operator) external {
        update();
        delete localData().earningsBeforeReferenceUpdate[operator];
        delete localData().cumulativeReference[operator];
    }

    /**
     * When stake changes, update the cumulativeReference per-operator reference point
     */
    function onStakeChange(address operator, int stakeChangeWei) external {
        LocalStorage storage local = localData();
        update();

        // must use pre-increase stake for the past period => undo the stakeChangeWei just for the calculation
        uint oldStakeWei = uint(int(stakedWei[operator]) - stakeChangeWei);

        // Reference Point Update => move new earnings since last reference update to earningsBeforeReferenceUpdate
        uint newEarningsPer1e36Stake = local.cumulativeWeiPer1e36Stake - local.cumulativeReference[operator];
        local.earningsBeforeReferenceUpdate[operator] += oldStakeWei * newEarningsPer1e36Stake / 1e36;
        local.cumulativeReference[operator] = local.cumulativeWeiPer1e36Stake; // <- this is the reference update
    }

    /** @return payoutWei how many tokens to send out from Sponsorship */
    function onWithdraw(address operator) external returns (uint payoutWei) {
        update();

        // calculate payout FIRST, before zeroing earningsBeforeReferenceUpdate
        payoutWei = getEarningsWei(operator);
        console.log("onWithdraw", earningsWei, payoutWei);
        earningsWei -= payoutWei;

        // update reference point, also zero the "unpaid earnings" because they will be paid out
        LocalStorage storage local = localData();
        local.cumulativeReference[operator] = local.cumulativeWeiPer1e36Stake;
        local.earningsBeforeReferenceUpdate[operator] = 0;
    }

    function onSponsor(address, uint amount) external {
        if (amount == 0) { return; }

        update();

        // has been insolvent but now has funds again => back to normal
        //   don't distribute anything yet but start counting again
        LocalStorage storage localVars = localData();
        if (localVars.defaultedWei > 0) {
            emit InsolvencyEnded(block.timestamp, localVars.defaultedWeiPer1e36Stake / 1e18, localVars.defaultedWei);
            localVars.defaultedWeiPer1e36Stake = 0;
            localVars.defaultedWei = 0;
        }
        emit ProjectedInsolvencyUpdate(getInsolvencyTimestamp());
    }
}
