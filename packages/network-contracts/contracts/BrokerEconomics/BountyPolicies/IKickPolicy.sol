// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IKickPolicy {
    function setParam(uint256 param) external;
    function onFlag(address broker, address brokerPool) external;
    function onCancelFlag(address broker, address brokerPool) external;
    function onVote(address broker, bytes32 voteData) external;
}
