// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IKickPolicy {
    function setParam(uint256 param) external;

    /** @return kickPenaltyWei zero means do not kick */
    function onReport(address broker, address reporter) external returns (uint kickPenaltyWei);
}
