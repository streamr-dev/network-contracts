//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./DelegatedAccessRegistry.sol";

// Used only for testing purposes
contract TestERC721 is ERC721 {
    constructor () ERC721("TestToken", "TST") {}

    function mint(address account, uint256 tokenId) public {
        _mint(account, tokenId);
    }
}

contract ERC721JoinPolicy is GatedJoinPolicy{
    IERC721 public token;
    DelegatedAccessRegistry private delegatedAccessRegistry;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        address delegatedAccessRegistryAddress
    ) GatedJoinPolicy(
        streamRegistryAddress,
        streamId_,
        permissions_
    ) {
        token = IERC721(tokenAddress);
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
    }

    function canJoin(address user_, uint256 tokenId_) public view returns (bool) {
        return (token.ownerOf(tokenId_) == user_);
    }

    function requestDelegatedJoin(
        address delegatedWallet,
        uint256 tokenId_
    ) public {
        require(delegatedAccessRegistry.isUserAuthorized(_msgSender(), delegatedWallet), "Given wallet is not authorized in delegated registry");
        require(canJoin(_msgSender(), tokenId_), "Not enough tokens");
        accept(delegatedWallet);
    }
}