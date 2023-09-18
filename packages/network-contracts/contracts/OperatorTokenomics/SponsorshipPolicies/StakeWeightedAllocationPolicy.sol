// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IAllocationPolicy.sol";
import "../Sponsorship.sol";

// import "hardhat/console.sol";

// allocation happens over time, so there's necessarily lots of "relying on time" here
/* solhint-disable not-rely-on-time */

/**
 * @dev note: ...perStake variables are per FULL TOKEN stake for numerical precision reasons, internally.
 * @dev  Don't ever expose them outside! We don't want to deal with non-standard "full tokens", e.g. USDC has 6 decimals instead of 18
 * @dev Detailed reason: if incomePerSecondPerStake were per stake-wei, then because stake typically is greater than the payout in one second,
 * @dev  the quotient would always be zero.
 * @dev Example: 1 DATA/second, 1000 DATA staked:
 * @dev  - incomePerSecondPerStake(wei) would be 1e18 / 1000e18 < 1, which becomes zero
 * @dev  - incomePerSecondPerStake(token) however is 1e18 / 1000 = 1e15, which is fine
 * @dev Sanity check: There's order of 1e9 of DATA full tokens in existence, and one year is 3e7 seconds, so the precision is good enough
 * @dev  for the case where ALL data is staked on a sponsorship that pays 1 DATA/year
 */
contract StakeWeightedAllocationPolicy is IAllocationPolicy, Sponsorship {
    struct LocalStorage {
        uint incomePerSecond; // wei, total income velocity, distributed to operators
        uint cumulativeWeiPerStake; // cumulative time-income per stake FULL TOKEN unit (wei x 1e18)

        /**
         * The per-stake-unit allocation (wei / full token stake) of each operator is calculated as
         *   cumulativeWeiPerStake (common to all operators) minus cumulativeReference (for this operator)
         * This reference point will be updated when stake changes because that's when the operator-specific allocation velocity changes
         * The earnings, then, are simply stake * allocation
         */
        mapping(address => uint) cumulativeReference;
        /** At each reference point update, remember how much earnings there were before */
        mapping(address => uint) earningsBeforeRPU; // RPU = Reference Point Update

        // the current unallocated funds will run out if more sponsorship is not added
        uint defaultedWei; // lost income during the current insolvency; reported in InsolvencyEnded event, not used in allocations
        uint defaultedWeiPerStake; // lost cumulativeWeiPerStake during the current insolvency; reported in InsolvencyEnded event, not used in allocations

        // calculation inputs in the beginning of the currently running update period
        //   explicitly stored in the end of last update() because they will be the primary inputs to next update()
        // it's important to call the update() when things that affect allocation change (like incomePerSecond or stakedWei)
        uint lastUpdateTimestamp;
        uint lastUpdateTotalStake;
        uint lastUpdateUnallocatedWei;
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
        return localData().earningsBeforeRPU[operator] + calculateNewEarnings(localData().cumulativeReference[operator], stakedWei[operator]);
    }

    /**
     * Calculate an operator's earnings since the last reset of the per-operator reference point (cumulativeReference)
     */
    function calculateNewEarnings(uint referenceWeiPerStake, uint stakeWei) internal view returns (uint allocation) {
        LocalStorage storage local = localData();
        (uint newAllocationsWei,) = calculateSinceLastUpdate();

        uint cumulativeWeiPerStake = local.cumulativeWeiPerStake + newAllocationsWei * 1e18 / local.lastUpdateTotalStake;
        uint allocationWeiPerStake = cumulativeWeiPerStake - referenceWeiPerStake;
        return stakeWei * allocationWeiPerStake / 1e18; // full token = 1e18 wei
    }

    function calculateSinceLastUpdate() private view returns (uint newAllocationsWei, uint newDefaultsWei) {
        newAllocationsWei = 0;
        newDefaultsWei = 0;
        LocalStorage storage localVars = localData();
        if (localVars.lastUpdateWasRunning) {
            uint deltaTime = block.timestamp - localVars.lastUpdateTimestamp;
            uint owedWei = localVars.incomePerSecond * deltaTime;
            if (owedWei > 0) {
                // console.log("    lastUpdateTimestamp", localVars.lastUpdateTimestamp, "block.timestamp", block.timestamp);
                // was solvent in the start => calculate the past update period (until insolvency, if went insolvent)
                if (localVars.defaultedWei == 0) {
                    // default: allocate what is owed
                    newAllocationsWei = owedWei;

                    // in case of insolvency: allocate all remaining funds (according to weights) up to the start of insolvency
                    // NOTE: Insolvency won't start if unallocatedWei goes to exactly zero. This is to give a "benefit of doubt" to the sponsorship:
                    //   perhaps in the same block, a top-up still arrives, and then emitting insolvency events would be spurious.
                    // The insolvency only starts once update is called when there's non-zero allocations that aren't covered.
                    if (localVars.lastUpdateUnallocatedWei < owedWei) {
                        newAllocationsWei = localVars.lastUpdateUnallocatedWei;
                        newDefaultsWei = owedWei - newAllocationsWei;

                    }
                } else {
                    // state of insolvency continued throughout the update period, default on all owed tokens
                    newDefaultsWei = owedWei;
                }
            }
        }
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeWeiPerStake
     * New funds that may have entered in the meanwhile are only counted towards the next update,
     *   so they appear the have arrived after this update() call.
     */
    function update() private {
        LocalStorage storage localVars = localData();
        (uint newAllocationsWei, uint newDefaultsWei) = calculateSinceLastUpdate();

        if (newDefaultsWei > 0) {
            if (localVars.defaultedWei == 0) { // was previously still solvent (had not defaulted yet)
                uint insolvencyStartTime = localVars.lastUpdateTimestamp + newAllocationsWei / localVars.incomePerSecond;
                emit InsolvencyStarted(insolvencyStartTime);
            }
            localVars.defaultedWei += newDefaultsWei;
            localVars.defaultedWeiPerStake += newDefaultsWei * 1e18 / localVars.lastUpdateTotalStake;
        }

        if (newAllocationsWei > 0) {
            // move funds from unallocated to allocated
            allocatedWei += newAllocationsWei;
            unallocatedWei -= newAllocationsWei;
            localVars.cumulativeWeiPerStake += newAllocationsWei * 1e18 / localVars.lastUpdateTotalStake;
        }

        // save values for next update: adjust income velocity for a possibly changed number of operators
        localVars.lastUpdateTimestamp = block.timestamp;
        localVars.lastUpdateUnallocatedWei = unallocatedWei;
        localVars.lastUpdateTotalStake = totalStakedWei;
        localVars.lastUpdateWasRunning = isRunning();
    }

    /** @return insolvencyTimestamp when the (unallocated) funds would run out */
    function getInsolvencyTimestamp() public override(IAllocationPolicy) view returns (uint insolvencyTimestamp) {
        uint incomePerSecond = localData().incomePerSecond;
        if (incomePerSecond == 0) { return 2**255; } // indefinitely solvent

        return localData().lastUpdateTimestamp + unallocatedWei / incomePerSecond;
    }

    /** When operator joins, the current reference point is reset, and later the operator's allocation can be measured from the accumulated difference */
    function onJoin(address operator) external {
        update();
        localData().cumulativeReference[operator] = localData().cumulativeWeiPerStake;
    }

    /** When operator leaves, its state is cleared as if it had never joined */
    function onLeave(address operator) external {
        update();
        delete localData().earningsBeforeRPU[operator];
        delete localData().cumulativeReference[operator];
    }

    /**
     * When stake changes, update the reference point
     */
    function onStakeChange(address operator, int stakeChangeWei) external {
        LocalStorage storage local = localData();
        update();

        // must use pre-increase stake for the past period => undo the stakeChangeWei just for the calculation
        uint oldStakeWei = uint(int(stakedWei[operator]) - stakeChangeWei);

        // update reference point: move new earnings to earningsBeforeRPU
        local.earningsBeforeRPU[operator] += calculateNewEarnings(local.cumulativeReference[operator], oldStakeWei);
        local.cumulativeReference[operator] = local.cumulativeWeiPerStake;
    }

    /** @return payoutWei how many tokens to send out from Sponsorship */
    function onWithdraw(address operator) external returns (uint payoutWei) {
        update();

        // calculate payout FIRST, before zeroing earningsBeforeRPU
        payoutWei = getEarningsWei(operator);
        allocatedWei -= payoutWei;

        // update reference point, also zero the "unpaid earnings" because they will be paid out
        LocalStorage storage local = localData();
        local.cumulativeReference[operator] = local.cumulativeWeiPerStake;
        local.earningsBeforeRPU[operator] = 0;
    }

    function onSponsor(address, uint amount) external {
        if (amount == 0) { return; }

        update();

        // has been insolvent but now has funds again => back to normal
        //   don't distribute anything yet but start counting again
        LocalStorage storage localVars = localData();
        if (localVars.defaultedWei > 0) {
            emit InsolvencyEnded(block.timestamp, localVars.defaultedWeiPerStake, localVars.defaultedWei);
            localVars.defaultedWeiPerStake = 0;
            localVars.defaultedWei = 0;
        }
        emit ProjectedInsolvencyUpdate(getInsolvencyTimestamp());
    }
}
