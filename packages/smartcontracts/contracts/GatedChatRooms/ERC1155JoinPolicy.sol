//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./DelegatedAccessRegistry.sol";

// Used only for testing purposes
contract TestERC1155 is ERC1155 {
    constructor () ERC1155("TestToken") {}

    function mint(address account, uint256 id, uint256 amount) public {
        _mint(account, id, amount, "0x00");
    }
}

contract ERC1155JoinPolicy is GatedJoinPolicy {

    IERC1155 public token;

    mapping(uint256 => uint256) public tokenIdsToMinRequiredBalances;
    DelegatedAccessRegistry private delegatedAccessRegistry;


    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256[] memory tokenIds_,
        uint256[] memory minRequiredBalances_,
        address delegatedAccessRegistryAddress

    ) GatedJoinPolicy(
        streamRegistryAddress,
        streamId_,
        permissions_
    ) {
        require(tokenIds_.length == minRequiredBalances_.length, "ids and balances length diff");

        for (uint256 i = 0; i < tokenIds_.length; i++) {
            tokenIdsToMinRequiredBalances[tokenIds_[i]] = minRequiredBalances_[i];
        }
        token = IERC1155(tokenAddress);
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
    }

    function canJoin(address user_, uint256 tokenId_) public view returns (bool) {
        return (token.balanceOf(user_, tokenId_) >= tokenIdsToMinRequiredBalances[tokenId_]);
    }
    
    function requestDelegatedJoin(
        address delegatedWallet,
        uint256 tokenId_
    ) public {
        require(delegatedAccessRegistry.isUserAuthorized(_msgSender(), delegatedWallet), "Unauthorized");
        require(canJoin(_msgSender(), tokenId_), "Not enough tokens");
        accept(delegatedWallet);
    }
    
    
}