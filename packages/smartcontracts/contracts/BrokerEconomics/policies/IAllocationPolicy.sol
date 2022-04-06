// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IAllocationPolicy {
    function calculateAllocation(address broker) external returns (uint allocation);
    function calculatePenaltyOnStake(address broker) external view returns (uint256 stake);
}
