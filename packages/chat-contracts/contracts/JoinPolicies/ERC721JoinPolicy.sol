//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

import "./NFTJoinPolicy.sol";

contract ERC721JoinPolicy is NFTJoinPolicy, ERC721Holder {
        IERC721 public token;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256[] memory tokenIds_,
        address delegatedAccessRegistryAddress,
        bool stakingEnabled_
    ) NFTJoinPolicy (
        streamRegistryAddress,
        streamId_,
        permissions_,
        tokenIds_,
        0,
        delegatedAccessRegistryAddress,
        stakingEnabled_
    ) {
        token = IERC721(tokenAddress);
    }

    modifier canJoin(uint256 tokenId) override {
        require(token.ownerOf(tokenId) == msg.sender, "error_notEnoughTokens");
        _;
    }

    function _depositStake(
        uint256 tokenId,
        uint256 /*amount*/
    )
        override
        internal
        isStakingEnabled()
        isTokenIdIncluded(tokenId)
        isUserAuthorized()
        canJoin(tokenId) 
    {
        token.safeTransferFrom(msg.sender, address(this), tokenId);
        balances[msg.sender][tokenId] = 1;
        stakedTokenIds[msg.sender].push(tokenId);
    }

    function _withdrawStake(
        uint256 tokenId,
        uint256 /*amount*/
    )
        override
        internal
        isStakingEnabled()
        isTokenIdIncluded(tokenId)
        isUserAuthorized() 
    {
        token.safeTransferFrom(address(this), msg.sender, tokenId);
        balances[msg.sender][tokenId] = 0;
        for (uint i = 0; i < stakedTokenIds[msg.sender].length; i++) {
            if (stakedTokenIds[msg.sender][i] == tokenId) {
                stakedTokenIds[msg.sender][i] = stakedTokenIds[msg.sender][stakedTokenIds[msg.sender].length - 1];
                stakedTokenIds[msg.sender].pop();
                break;
            }
        }
    }
}