//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

// Used only for testing purposes
contract TestERC721 is ERC721 {
    constructor () ERC721("TestToken", "TST") {}

    function mint(address account, uint256 tokenId) public {
        _mint(account, tokenId);
    }
}