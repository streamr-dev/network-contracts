//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./DelegatedAccessRegistry.sol";

contract ERC721JoinPolicy is GatedJoinPolicy{
    IERC721 public token;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        address delegatedAccessRegistryAddress
    ) GatedJoinPolicy(
        streamRegistryAddress,
        delegatedAccessRegistryAddress,
        streamId_,
        permissions_
    ) {
        token = IERC721(tokenAddress);
    }

    modifier canJoin(uint256 tokenId_){
        require(token.ownerOf(tokenId_) == msg.sender, "error_notEnoughTokens");
        _;
    }

    function requestDelegatedJoin(
        address delegatedWallet,
        uint256 tokenId_
    )
        public
        isUserAuthorized(delegatedWallet)
        canJoin(tokenId_)
    {
        accept(msg.sender, delegatedWallet);
    }

    
}