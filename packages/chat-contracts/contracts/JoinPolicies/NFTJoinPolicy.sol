//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BaseJoinPolicy.sol";

abstract contract NFTJoinPolicy is BaseJoinPolicy {
    // owner => tokenId => tokenBalance
    mapping(address => mapping(uint256=>uint256)) internal balances;
    // owner => tokenIds
    mapping(address => uint256[]) internal stakedTokenIds;

    constructor(
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256[] memory tokenIds_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress,
        bool stakingEnabled_
    ) BaseJoinPolicy (
        streamRegistryAddress,
        delegatedAccessRegistryAddress,
        streamId_,
        permissions_,
        stakingEnabled_
    ) {
        minRequiredBalance = minRequiredBalance_;
        for (uint256 i = 0; i < tokenIds_.length; i++) {
            tokenIds[tokenIds_[i]] = true;
        }
    }

    function requestJoin(uint256 tokenId) public canJoin(tokenId) {
        accept(msg.sender);
    }
    
    function requestDelegatedJoin(uint256 tokenId) 
        public
        isUserAuthorized() 
        canJoin(tokenId) 
    {
        address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
        accept(msg.sender, delegatedWallet);
    }

    function depositStake(uint256 tokenId, uint256 amount)
    virtual 
    public;

    function withdrawStake(uint256 tokenId, uint256 amount) 
    virtual 
    public;

    function getStakedBalance(address owner, uint256 tokenId) public view isStakingEnabled() returns (uint256) {
        return balances[owner][tokenId];
    }

    function getStakedTokenIds(address owner) public view isStakingEnabled() returns (uint256[] memory) {
        return stakedTokenIds[owner];
    }

    modifier isTokenIdIncluded(uint256 tokenId) {
        require(tokenIds[tokenId], "error_tokenIdNotIncluded");
        _;
    }

    modifier canJoin(uint256 tokenId) virtual;

   


}