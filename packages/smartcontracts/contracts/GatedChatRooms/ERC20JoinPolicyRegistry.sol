//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./ERC20JoinPolicy.sol";

contract ERC20JoinPolicyRegistry is Ownable {

    address public streamRegistryAddress;
    StreamRegistryV3 public streamRegistry;
    StreamRegistryV3.PermissionType[] public defaultPermissions;

    mapping(address => address) public tokensToJoinPolicies;

    constructor(
        address streamRegistryAddress_,
        StreamRegistryV3.PermissionType[] memory defaultPermissions_
    ) Ownable(){
        streamRegistryAddress = streamRegistryAddress_;
        defaultPermissions = defaultPermissions_;
    }

    function register(
        address tokenAddress,
        string memory streamId_,
        uint256 minRequiredBalance_
    ) public returns (address deployedPolicy) {
        require(minRequiredBalance_ > 0, "minRequiredBalance must be greater than 0");
        require(tokensToJoinPolicies[tokenAddress] == address(0x0), "Join policy already registered");

        ERC20JoinPolicy instance = new ERC20JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            minRequiredBalance_
        );
        deployedPolicy = address(instance);
        tokensToJoinPolicies[tokenAddress] = deployedPolicy;
        return deployedPolicy;
    }
}