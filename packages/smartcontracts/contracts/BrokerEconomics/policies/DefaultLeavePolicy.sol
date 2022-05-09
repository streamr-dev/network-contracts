// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./ILeavePolicy.sol";

contract DefaultLeavePolicy is ILeavePolicy {
    event Leave(string indexed streamID, address indexed broker);
    function checkPenaltyForLeaving(string calldata streamId, address broker) external returns (uint) {
        return 1;
    }
}