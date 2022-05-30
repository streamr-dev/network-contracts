// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./ILeavePolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract DefaultLeavePolicy is ILeavePolicy, Bounty {

    uint penaltyPeriodSeconds = 0;

    /**
     * After penaltyPeriod, leaving is always okay
     * During penaltyPeriod, leaving is only okay if bounty is not running
     */
    function getLeavePenaltyWei(address broker) public override view returns (uint leavePenaltyWei) {
        uint joinTimestamp = globalData().joinTimeOfBroker[broker];
        if (block.timestamp >= joinTimestamp + penaltyPeriodSeconds) {
            return 0;
        }

        uint stake = globalData().stakedWei[broker];
        // console.log("getLeavePenaltyWei, stake =", stake);
        State bountyState = getState();
        if (bountyState == State.Running) {
            // console.log("Leaving a running bounty, lose stake");
            return stake;
        }
        // console.log("Get stake back");
        return 0;
    }

    function setParam(uint256 penaltyPeriod) external {
        penaltyPeriodSeconds = penaltyPeriod;
    }
}