//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../StreamRegistry/StreamRegistryV3.sol"; 
import "./JoinPolicy.sol";
import "../DelegatedAccessRegistry.sol";

contract ERC1155JoinPolicy is JoinPolicy {

    IERC1155 public token;

    uint256 tokenId;
    uint256 minRequiredBalance;

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

}