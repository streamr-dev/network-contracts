// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IKickPolicy {
    enum FlagState {
        NONE,
        VOTING,
        KICKED,
        NOT_KICKED
    }

    function setParam(uint param) external;
    function onFlag(address target, address flagger) external;
    function onVote(address operator, bytes32 voteData, address voter) external;
    function getFlagData(address operator) external view returns (uint flagData);
    function getMinimumStakeOf(address operator) external view returns (uint individualMinimumStakeWei);
}
