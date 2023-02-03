//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CoinJoinPolicy.sol";

contract ERC20JoinPolicy is CoinJoinPolicy {
    IERC20 public token;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress,
        bool stakingEnabled_
    ) CoinJoinPolicy (
        streamRegistryAddress,
        streamId_,
        permissions_,
        minRequiredBalance_,
        delegatedAccessRegistryAddress,
        stakingEnabled_
    ) {
        token = IERC20(tokenAddress);
    }

    modifier canJoin() override {
        require(token.balanceOf(msg.sender) >= minRequiredBalance, "error_notEnoughTokens");
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
        token.transferFrom(msg.sender, address(this), amount);
        balances[msg.sender] = balances[msg.sender] + amount;
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
        token.transfer(msg.sender, amount);
        balances[msg.sender] = balances[msg.sender] - amount;
        if (balances[msg.sender] < minRequiredBalance) {
            address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
            revoke(msg.sender, delegatedWallet);
        }
    }

}