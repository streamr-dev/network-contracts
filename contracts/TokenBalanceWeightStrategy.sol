pragma solidity ^0.5.16;

import "./WeightStrategy.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";

contract TokenBalanceWeightStrategy is WeightStrategy {
    ERC20 token;

    constructor(address tokenAddress) public {
        token = ERC20(tokenAddress);
    }

    function getWeight(address nodeAddress) public view returns (uint) {
       return token.balanceOf(nodeAddress);
    }
}
