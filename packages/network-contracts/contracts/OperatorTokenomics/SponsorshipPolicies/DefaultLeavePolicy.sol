// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./ILeavePolicy.sol";
import "../Sponsorship.sol";

contract DefaultLeavePolicy is ILeavePolicy, Sponsorship {

    uint public penaltyPeriodSeconds = 0;

    function setParam(uint penaltyPeriod) external {
        require (penaltyPeriod <= streamrConfig.maxPenaltyPeriodSeconds(), "error_penaltyPeriodTooLong");
        penaltyPeriodSeconds = penaltyPeriod;
    }

    /**
     * After penaltyPeriod, leaving is always okay
     * During penaltyPeriod, leaving is only okay if sponsorship is not running
     */
    function getLeavePenaltyWei(address operator) public override view returns (uint leavePenaltyWei) {
        uint joinTimestamp = joinTimeOfOperator[operator];
        if (block.timestamp >= joinTimestamp + penaltyPeriodSeconds) { // solhint-disable-line not-rely-on-time
            // console.log("Penalty period over, get stake back");
            return 0;
        }

        uint stake = stakedWei[operator];
        // console.log("getLeavePenaltyWei, stake =", stake, isRunning() ? "[running]" : "[NOT running]", isFunded() ? "[funded]" : "[NOT funded]");
        if (isRunning() && isFunded()) {
            // console.log("Leaving a running sponsorship too early, lose slashingFraction of stake");
            return stake * streamrConfig.slashingFraction() / 1 ether;
        }
        // console.log("Sponsorship not running, get stake back");
        return 0;
    }
}
