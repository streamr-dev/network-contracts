//SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./DelegatedAccessRegistry.sol";

contract ERC1155JoinPolicy is GatedJoinPolicy {

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
        address delegatedAccessRegistryAddress

    ) GatedJoinPolicy(
        streamRegistryAddress,
        delegatedAccessRegistryAddress,
        streamId_,
        permissions_
    ) {
        require(minRequiredBalance_ > 0, "minReqBalance must be > 0");
        tokenIdsToMinRequiredBalances[tokenId_] = minRequiredBalance_;
        token = IERC1155(tokenAddress);
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
    }

    /*

    function canJoin(address user_, uint256 tokenId_) public view returns (bool) {
        return (tokenIdsToMinRequiredBalances[tokenId_] > 0 && token.balanceOf(user_, tokenId_) >= tokenIdsToMinRequiredBalances[tokenId_]);
    }
    
    function requestDelegatedJoin(
        address delegatedWallet,
        uint256 tokenId_
    ) public {
        require(delegatedAccessRegistry.isUserAuthorized(_msgSender(), delegatedWallet), "Unauthorized");
        require(canJoin(_msgSender(), tokenId_), "Not enough tokens");
        accept(_msgSender(), delegatedWallet);
    }
    
    */
}