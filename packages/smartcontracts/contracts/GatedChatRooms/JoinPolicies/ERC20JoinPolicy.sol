//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../StreamRegistry/StreamRegistryV3.sol"; 
import "./JoinPolicy.sol";
import "../DelegatedAccessRegistry.sol";

contract ERC20JoinPolicy is JoinPolicy{
    IERC20 public token;
    uint256 public minRequiredBalance;
    // owner => tokenBalance
    mapping(address => uint256) balances;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
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
        token = IERC20(tokenAddress);
        minRequiredBalance = minRequiredBalance_;
    }

    modifier canJoin() override {
        require(token.balanceOf(msg.sender) >= minRequiredBalance, "error_notEnoughTokens");
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
        canJoin(0) 
    {
        token.transferFrom(msg.sender, address(this), amount);
        balances[msg.sender] = SafeMath.add(balances[msg.sender], amount);
        accept(msg.sender, delegatedWallet);
    }

    function withdrawStake(
        uint256 amount,
        address delegatedWallet
    ) 
        override
        public 
        isStakingEnabled()
        isUserAuthorized(delegatedWallet) 
        canJoin(0) 
    {
        token.transfer(msg.sender, amount);
        balances[msg.sender] = SafeMath.sub(balances[msg.sender], amount);
        if (balances[msg.sender] < minRequiredBalance) {
            revoke(msg.sender, delegatedWallet);
        }
    }
    */
}

