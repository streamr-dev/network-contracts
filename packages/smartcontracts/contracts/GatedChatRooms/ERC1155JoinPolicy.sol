//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";

// Used only for testing purposes
contract TestERC1155 is ERC1155 {
    constructor () ERC1155("TestToken") {}

    function mint(address account, uint256 id, uint256 amount) public {
        _mint(account, id, amount, '0x00');
    }
}

contract ERC1155JoinPolicy is GatedJoinPolicy {

    IERC1155 public token;

    mapping(uint256 => uint256) public tokenIdsToMinRequiredBalances;


    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256[] memory tokenIds_,
        uint256[] memory minRequiredBalances_
    ) GatedJoinPolicy(
        streamRegistryAddress,
        streamId_,
        permissions_
    ) {
        token = IERC1155(tokenAddress);
        require(tokenIds_.length == minRequiredBalances_.length, "tokenIds and minRequiredBalances must be of the same length");

        for (uint256 i = 0; i < tokenIds_.length; i++) {
            tokenIdsToMinRequiredBalances[tokenIds_[i]] = minRequiredBalances_[i];
        }
    }

    function canJoin(address user_, uint256 tokenId_) public view returns (bool) {
        return (token.balanceOf(user_, tokenId_) >= tokenIdsToMinRequiredBalances[tokenId_]);
    }
    
    function requestDelegatedJoin(
        uint256 tokenId_,
        address delegatedUser_,
        bytes32 challenge_,
        bytes memory signature_
    ) public {
        require(canJoin(_msgSender(), tokenId_), "Not enough tokens");
        require(recoverSigner(challenge_, signature_) == delegatedUser_, "Signature is not valid");
        accept(delegatedUser_);
    }
    
    
}