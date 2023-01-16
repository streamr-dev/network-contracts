//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@streamr-contracts/network-contracts/contracts/StreamRegistry/StreamRegistryV3.sol";
import "./JoinPolicy.sol";
import "../DelegatedAccessRegistry.sol";

contract ERC1155JoinPolicy is JoinPolicy, ERC1155Holder {
    IERC1155 public token;

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
        minRequiredBalance = minRequiredBalance_;
        tokenId = tokenId_;
        token = IERC1155(tokenAddress);
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
    }

    modifier canJoin() override {
        require((token.balanceOf(msg.sender, tokenId) >= minRequiredBalance), "error_notEnoughTokens");
        _;
    }

    function depositStake(
        uint256 amount
    )
        override
        public 
        isStakingEnabled()
        isUserAuthorized() 
        canJoin() 
    {
        token.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        balances[msg.sender]= SafeMath.add(balances[msg.sender], amount);
        address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
        accept(msg.sender, delegatedWallet);
    }

    function withdrawStake(
        uint256 amount
    )
        override
        public 
        isStakingEnabled()
        isUserAuthorized() 
    {
        token.safeTransferFrom(address(this), msg.sender, tokenId, amount, "");
        balances[msg.sender] = SafeMath.sub(balances[msg.sender], amount);
        if (balances[msg.sender] < minRequiredBalance) {
            address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
            revoke(msg.sender, delegatedWallet);
        }
    }
}