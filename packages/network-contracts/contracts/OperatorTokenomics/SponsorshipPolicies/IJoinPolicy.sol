// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IJoinPolicy {
    function setParam(uint param) external;
    function onJoin(address operator, uint amount) external;
}
