// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolJoinPolicy {
    function setParam(uint256 param) external;
    function onPoolJoin(address delegator, uint256 amount) external returns (uint256 amountPoolTokens);
}
