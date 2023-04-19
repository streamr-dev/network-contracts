// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IKickPolicy {
    function setParam(uint256 param) external;
    function onFlag(address target) external;
    function onVote(address operator, bytes32 voteData) external;
    function getFlagData(address operator) external view returns (uint flagData);
}
