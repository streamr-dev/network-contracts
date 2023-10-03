// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IRandomOracle {
    function getRandomBytes32() external returns (bytes32);
}
