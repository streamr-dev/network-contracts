// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./ILeavePolicy.sol";
import "../Sponsorship.sol";

contract DefaultLeavePolicy is ILeavePolicy, Sponsorship {

    // TODO: use LocalStorage pattern for this
    uint public penaltyPeriodSeconds; // = 0

    function setParam(uint penaltyPeriod) external {
        require (penaltyPeriod <= streamrConfig.maxPenaltyPeriodSeconds(), "error_penaltyPeriodTooLong");
        penaltyPeriodSeconds = penaltyPeriod;
    }

    /**
     * After penaltyPeriod, leaving is always okay
     * During penaltyPeriod, leaving is only okay if sponsorship is not paying for the service
     */
    function getLeavePenaltyWei(address operator) public override view returns (uint leavePenaltyWei) {
        uint joinTimestamp = joinTimeOfOperator[operator];
        if (block.timestamp >= joinTimestamp + penaltyPeriodSeconds) { // solhint-disable-line not-rely-on-time
            return 0;
        }

        if (isRunning() && isFunded()) {
            return streamrConfig.earlyLeaverPenaltyWei();
        }
        return 0;
    }
}
