//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./DelegatedAccessRegistry.sol";

// Used only for testing purposes
contract TestERC20 is ERC20 {
    constructor () ERC20("TestToken", "TST") {}

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }
}

contract ERC20JoinPolicy is GatedJoinPolicy{
    IERC20 public token;
    uint256 public minRequiredBalance;
    DelegatedAccessRegistry private delegatedAccessRegistry;

    constructor(
        address tokenAddress,
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress
    ) GatedJoinPolicy(
        streamRegistryAddress,
        streamId_,
        permissions_
    ) {
        token = IERC20(tokenAddress);
        minRequiredBalance = minRequiredBalance_;
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
    }

    function canJoin(address user_) public view returns (bool) {
        return (token.balanceOf(user_) >= minRequiredBalance);
    }

    function requestDelegatedJoin(
        address delegatedWallet
    ) public {
        require(delegatedAccessRegistry.isUserAuthorized(_msgSender(), delegatedWallet), "Unauthorized");
        require(canJoin(_msgSender()), "Not enough tokens");
        accept(delegatedWallet);
    }



}

