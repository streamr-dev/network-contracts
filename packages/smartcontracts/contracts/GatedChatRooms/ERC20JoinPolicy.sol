//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./DelegatedAccessRegistry.sol";

contract ERC20JoinPolicy is GatedJoinPolicy{
    IERC20 public token;
    uint256 public minRequiredBalance;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress
    ) GatedJoinPolicy(
        streamRegistryAddress,
        delegatedAccessRegistryAddress,
        streamId_,
        permissions_
    ) {
        require(minRequiredBalance_ > 0, "error_minReqBalanceGt0");
        token = IERC20(tokenAddress);
        minRequiredBalance = minRequiredBalance_;
    }

    modifier canJoin{
        require(token.balanceOf(msg.sender) >= minRequiredBalance, "error_notEnoughTokens");
        _;
    }

    function requestDelegatedJoin(
        address delegatedWallet
    ) 
        public
        isUserAuthorized(delegatedWallet) 
        canJoin() 
    {
        accept(msg.sender, delegatedWallet);
    }



}

