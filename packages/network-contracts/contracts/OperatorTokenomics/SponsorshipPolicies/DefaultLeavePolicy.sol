// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./ILeavePolicy.sol";
import "../Sponsorship.sol";

contract DefaultLeavePolicy is ILeavePolicy, Sponsorship {

    uint public penaltyPeriodSeconds = 0;

    /**
     * After penaltyPeriod, leaving is always okay
     * During penaltyPeriod, leaving is only okay if sponsorship is not running
     */
    function getLeavePenaltyWei(address broker) public override view returns (uint leavePenaltyWei) {
        uint joinTimestamp = joinTimeOfBroker[broker];
        if (block.timestamp >= joinTimestamp + penaltyPeriodSeconds) { // solhint-disable-line not-rely-on-time
            // console.log("Penalty period over, get stake back");
            return 0;
        }

        uint stake = stakedWei[broker];
        // console.log("getLeavePenaltyWei, stake =", stake, isRunning() ? "[running]" : "[NOT running]", isFunded() ? "[funded]" : "[NOT funded]");
        if (isRunning() && isFunded()) {
            // console.log("Leaving a running sponsorship too early, lose 10% of stake");
            return stake / 10;
        }
        // console.log("Sponsorship not running, get stake back");
        return 0;
    }

    function setParam(uint256 penaltyPeriod) external {
        require (penaltyPeriod <= streamrConfig.maxPenaltyPeriodSeconds(), "error_penaltyPeriodTooLong");
        penaltyPeriodSeconds = penaltyPeriod;
    }
}
