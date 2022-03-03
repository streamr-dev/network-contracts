// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "./IJoinPolicy.sol";

contract DefaultJoinPolicy is IJoinPolicy {
    event Joining(string indexed streamID, address indexed broker);
    function checkAbleToJoin(string calldata streamId, address broker) external returns (bool) {
        return true;
    }
}