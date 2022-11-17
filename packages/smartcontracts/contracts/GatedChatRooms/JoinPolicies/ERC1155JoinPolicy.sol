//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../StreamRegistry/StreamRegistryV3.sol"; 
import "./JoinPolicy.sol";
import "../DelegatedAccessRegistry.sol";

contract ERC1155JoinPolicy is JoinPolicy {

    IERC1155 public token;
    // tokenId => minRequiredBalance
    mapping(uint256 => uint256) public tokenIdsToMinRequiredBalances;
    DelegatedAccessRegistry private delegatedAccessRegistry;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 tokenId_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress,
        bool stakingEnabled_
    ) JoinPolicy (
        streamRegistryAddress,
        delegatedAccessRegistryAddress,
        streamId_,
        permissions_,
        stakingEnabled_
    ) {
        require(minRequiredBalance_ > 0, "error_minReqBalanceGt0");
        tokenIdsToMinRequiredBalances[tokenId_] = minRequiredBalance_;
        token = IERC1155(tokenAddress);
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
    }

    modifier canJoin(uint256 tokenId_) override {
        require((tokenIdsToMinRequiredBalances[tokenId_] > 0 && token.balanceOf(msg.sender, tokenId_) >= tokenIdsToMinRequiredBalances[tokenId_]), "error_notEnoughTokens");
        _;
    }

    function requestDelegatedJoin(
        address delegatedWallet,
        uint256 tokenId_
    )
        public
        override
        isUserAuthorized(delegatedWallet)
        canJoin(tokenId_)
    {
        accept(msg.sender, delegatedWallet);
    }

    function requestJoin(
        uint256 tokenId_
    )
        public
        override
        canJoin(tokenId_)
    {
        accept(msg.sender);
    }
}