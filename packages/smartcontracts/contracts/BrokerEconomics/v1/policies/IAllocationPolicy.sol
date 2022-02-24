// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IAllocationPolicy {
    function calculateAllocation(string calldata streamId, address broker) external returns (uint allocation);
}
