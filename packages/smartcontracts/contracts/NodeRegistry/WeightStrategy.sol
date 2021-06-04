// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.0;

interface WeightStrategy {
    function getWeight(address nodeAddress) external view returns (uint);
}