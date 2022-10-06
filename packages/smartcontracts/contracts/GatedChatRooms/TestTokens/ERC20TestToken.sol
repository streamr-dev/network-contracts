// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor () ERC20("TestToken", "TST") {}

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }
}