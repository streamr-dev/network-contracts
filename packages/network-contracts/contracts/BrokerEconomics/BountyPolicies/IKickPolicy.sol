// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IKickPolicy {
    function setParam(uint256 param) external;
    function onFlag(address broker) external;
    function onCancelFlag(address broker) external;
    function onVote(address broker, bytes32 voteData) external;
}
