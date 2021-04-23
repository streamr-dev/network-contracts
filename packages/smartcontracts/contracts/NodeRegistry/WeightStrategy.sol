// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface WeightStrategy {
    function getWeight(address nodeAddress) external view returns (uint);
}