//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../StreamRegistry/StreamRegistryV3.sol"; 
import "./JoinPolicy.sol";
import "../DelegatedAccessRegistry.sol";

contract ERC721JoinPolicy is JoinPolicy{
    IERC721 public token;
    uint256 public tokenId;

    // owner => tokenBalance
    mapping(address => uint256) balances;

    constructor(
        address tokenAddress,
        uint256 tokenId_,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
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
/*

    function depositStake(
        uint256 amount,
        address delegatedWallet
    )
        override
        public 
        isStakingEnabled()
        isUserAuthorized(delegatedWallet) 
        canJoin() 
    {
        token.safeTransferFrom(msg.sender, address(this), tokenId);
        balances[msg.sender] = 1;
        accept(msg.sender, delegatedWallet);
    }

    function withddrawStake(
        uint256 amount,
        address delegatedWallet
    )
        override
        public 
        isStakingEnabled()
        isUserAuthorized(delegatedWallet) 
    {
       token.safeTransferFrom(address(this), msg.sender, tokenId);
         balances[msg.sender] = 0;
         revoke(msg.sender, delegatedWallet);
    }
    */
}