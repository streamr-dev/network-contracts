// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface WeightStrategy {
    function getWeight(address nodeAddress) external view returns (uint);
}