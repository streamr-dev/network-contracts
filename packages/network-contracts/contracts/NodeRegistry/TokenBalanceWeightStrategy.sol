// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./WeightStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TokenBalanceWeightStrategy is WeightStrategy {
    ERC20 public token;

    constructor(address tokenAddress) {
        token = ERC20(tokenAddress);
    }

    function getWeight(address nodeAddress) public override view returns (uint) {
       return token.balanceOf(nodeAddress);
    }
}
