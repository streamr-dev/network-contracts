pragma solidity ^0.6.0;

import "./WeightStrategy.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract TokenBalanceWeightStrategy is WeightStrategy {
    ERC20 token;

    constructor(address tokenAddress) public {
        token = ERC20(tokenAddress);
    }

    function getWeight(address nodeAddress) public override view returns (uint) {
       return token.balanceOf(nodeAddress);
    }
}
