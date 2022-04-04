// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IJoinPolicy {
    function setParam(uint256 param) external;
    function checkAbleToJoin(address broker, uint amount) external view returns (bool);
}
