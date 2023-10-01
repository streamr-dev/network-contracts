// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../IRandomOracle.sol";

contract MockRandomOracle is IRandomOracle {
    bytes32[] public outcomes = [ bytes32(0x1234567812345678123456781234567812345678123456781234567812345678) ];
    uint public index = 0;

    function getRandomBytes32() external returns (bytes32 outcome) {
        outcome = outcomes[index];
        index = (index + 1) % outcomes.length;
    }

    function setOutcomes(bytes32[] calldata mockRandomBytes32List) external {
        require(outcomes.length > 0, "can't set empty outcomes array!");
        outcomes = mockRandomBytes32List;
        index = 0;
    }
}
