// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IJoinPolicy {
    function join(address broker, uint amount) external returns (bool);
}
