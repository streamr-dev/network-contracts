// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC777/ERC777.sol";

contract TestERC777 is ERC777 {
    address[] public _defaultOperators = [address(this)];
    constructor () ERC777("TestToken", "TST", _defaultOperators) {}

    function mint(address account, uint256 amount) public {
        _mint(account, amount, "", "");
    }
}