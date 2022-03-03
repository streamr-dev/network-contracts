// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IJoinPolicy {
    function checkAbleToJoin(string calldata streamId, address broker) external returns (bool);
}
