//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import "./NFTJoinPolicy.sol";

contract ERC1155JoinPolicy is NFTJoinPolicy, ERC1155Holder {
        IERC1155 public token;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256[] memory tokenIds_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress,
        bool stakingEnabled_
    ) NFTJoinPolicy (
        streamRegistryAddress,
        streamId_,
        permissions_,
        tokenIds_,
        minRequiredBalance_,
        delegatedAccessRegistryAddress,
        stakingEnabled_
    ) {
        require(minRequiredBalance_ > 0, "error_minReqBalanceGt0");

        token = IERC1155(tokenAddress);
    }

    modifier canJoin(uint256 tokenId) override {
        require((token.balanceOf(msg.sender, tokenId) >= minRequiredBalance), "error_notEnoughTokens");
        _;
    }

    function depositStake(
        uint256 tokenId,
        uint256 amount
    )
        override
        public 
        isStakingEnabled()
        isTokenIdIncluded(tokenId)
        isUserAuthorized()
        canJoin(tokenId) 
    {
        token.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        balances[msg.sender] = balances[msg.sender] + amount;
        address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
        accept(msg.sender, delegatedWallet);
    }

    function withdrawStake(
        uint256 tokenId,
        uint256 amount
    )
        override
        public 
        isStakingEnabled()
        isTokenIdIncluded(tokenId)
        isUserAuthorized() 
    {
        token.safeTransferFrom(address(this), msg.sender, tokenId, amount, "");
        balances[msg.sender] = balances[msg.sender] - amount;
        if (balances[msg.sender] < minRequiredBalance) {
            address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
            revoke(msg.sender, delegatedWallet);
        }
    }
}