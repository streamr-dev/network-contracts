// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface ILeavePolicy {
    function checkPenaltyForLeaving(string calldata streamId, address broker) external returns (uint penalty);
}
