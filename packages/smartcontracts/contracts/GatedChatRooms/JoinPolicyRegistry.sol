//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./ERC20JoinPolicy.sol";
import "./ERC1155JoinPolicy.sol";

contract JoinPolicyRegistry is Ownable {

    address public streamRegistryAddress;
    StreamRegistryV3 public streamRegistry;
    StreamRegistryV3.PermissionType[] public defaultPermissions;

    address public delegatedAccessRegistryAddress;

    mapping(address => address) public erc20TokensToJoinPolicies;
    mapping(address => mapping(uint256 => address)) public erc1155TokensToJoinPolicies;

   
    mapping(bytes32 => address) public registeredPolicies;

    constructor(
        address streamRegistryAddress_,
        StreamRegistryV3.PermissionType[] memory defaultPermissions_,
        address delegatedAccessRegistryAddress_
    ) Ownable(){
        streamRegistryAddress = streamRegistryAddress_;
        defaultPermissions = defaultPermissions_;
        delegatedAccessRegistryAddress = delegatedAccessRegistryAddress_;
    }

    function registerERC20Policy(
        address tokenAddress,
        string memory streamId_,
        uint256 minRequiredBalance_
    ) public returns (address deployedPolicy) {
        require(minRequiredBalance_ > 0, "minRequiredBalance must be greater than 0");
        bytes32 policyKey = keccak256(abi.encode(tokenAddress, streamId_));
        require(registeredPolicies[policyKey] == address(0x0), "Join policy already registered");

        ERC20JoinPolicy instance = new ERC20JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            minRequiredBalance_,
            delegatedAccessRegistryAddress
        );
        deployedPolicy = address(instance);
        erc20TokensToJoinPolicies[tokenAddress] = deployedPolicy;
        registeredPolicies[policyKey] = deployedPolicy;
        return deployedPolicy;
    }

    function registerERC1155Policy(
        address tokenAddress,
        uint256 tokenId,
        string memory streamId_,
        uint256[] memory tokenIds_,
        uint256[] memory minRequiredBalances_
    ) public returns (address deployedPolicy) {
        bytes32 policyKey = keccak256(abi.encode(tokenAddress, tokenId, streamId_));

        ERC1155JoinPolicy instance = new ERC1155JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            tokenIds_,
            minRequiredBalances_,
            delegatedAccessRegistryAddress
        );

        deployedPolicy = address(instance);
        erc1155TokensToJoinPolicies[tokenAddress][tokenId] = deployedPolicy;
        registeredPolicies[policyKey] = deployedPolicy;
        return deployedPolicy;
    }
}