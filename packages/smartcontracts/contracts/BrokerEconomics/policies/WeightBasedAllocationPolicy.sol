// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "./IAllocationPolicy.sol";

contract WeightBasedAllocationPolicy is IAllocationPolicy {
    event Leave(string indexed streamID, address indexed broker);
    function calculateAllocation(string calldata streamId, address broker) external returns (uint allocation) {
        return 100;
    }
}