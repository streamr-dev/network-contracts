//SPDX-License-Identifier: MIT
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
        token = IERC20(tokenAddress);
        require(minRequiredBalance_ > 0, "minReqBalance must be > 0");
        minRequiredBalance = minRequiredBalance_;
    }

    modifier canJoin{
        require(token.balanceOf(msg.sender) >= minRequiredBalance, "Not enough tokens");
        _;
    }

    function requestDelegatedJoin(
        address delegatedWallet
    ) 
        isUserAuthorized(delegatedWallet) 
        canJoin() 
        public 
    {
        accept(msg.sender, delegatedWallet);
    }



}

