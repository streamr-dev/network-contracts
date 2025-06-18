// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * ERC20Mintable is missing from open-zeppelin
 */
contract ERC20Mintable is ERC20 {
    address private creator;
    constructor() ERC20("Mintable Test Token", "TTT") {
        creator = msg.sender;
    }

    function mint(address receipient, uint amount) public {
       require(msg.sender == creator, "only_creator");
       _mint(receipient, amount);
    }
}
