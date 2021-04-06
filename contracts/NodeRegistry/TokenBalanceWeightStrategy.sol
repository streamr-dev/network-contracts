// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.7.6;

import "./WeightStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TokenBalanceWeightStrategy is WeightStrategy {
    ERC20 public token;

    constructor(address tokenAddress) public {
        token = ERC20(tokenAddress);
    }

    function getWeight(address nodeAddress) public override view returns (uint) {
       return token.balanceOf(nodeAddress);
    }
}
