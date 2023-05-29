//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@streamr/network-contracts/contracts/StreamRegistry/StreamRegistryV3.sol";
import "./JoinPolicy.sol";
import "../DelegatedAccessRegistry.sol";

contract ERC721JoinPolicy is JoinPolicy, ERC721Holder{
    IERC721 public token;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 tokenId_,
        address delegatedAccessRegistryAddress,
        bool stakingEnabled_
    ) JoinPolicy(
        streamRegistryAddress,
        delegatedAccessRegistryAddress,
        streamId_,
        permissions_,
        stakingEnabled_
    ) {
        token = IERC721(tokenAddress);
        tokenId = tokenId_;
    }

    modifier canJoin() override{
        require(token.ownerOf(tokenId) == msg.sender, "error_notEnoughTokens");
        _;
    }

    function depositStake(
        uint256 /*amount*/
    )
        override
        public
        isStakingEnabled()
        isUserAuthorized()
        canJoin()
    {
        token.safeTransferFrom(msg.sender, address(this), tokenId);
        balances[msg.sender] = 1;
        address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
        accept(msg.sender, delegatedWallet);
    }

    function withdrawStake(
        uint256 /*amount*/
    )
        override
        public
        isStakingEnabled()
        isUserAuthorized()
    {
       token.safeTransferFrom(address(this), msg.sender, tokenId);
         balances[msg.sender] = 0;
         address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
         revoke(msg.sender, delegatedWallet);
    }

}