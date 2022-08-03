//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./GatedJoinPolicy.sol";
import "./ERC20JoinPolicy.sol";
import "./ERC721JoinPolicy.sol";
import "./ERC1155JoinPolicy.sol";

contract JoinPolicyRegistry is Ownable {

    address public streamRegistryAddress;
    StreamRegistryV3 public streamRegistry;
    StreamRegistryV3.PermissionType[] public defaultPermissions;

    address public delegatedAccessRegistryAddress;

    mapping(address => address) public erc20TokensToJoinPolicies;
    mapping(address => mapping(uint256 => address)) public erc1155TokensToJoinPolicies;
    mapping(address => mapping(uint256 => address)) public erc721TokensToJoinPolicies;
   
    mapping(bytes32 => address) public registeredPolicies;

    event Registered(
        address indexed tokenAddress, 
        string indexed streamId, 
        address policyAddress, 
        bytes32 policyId
    );

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
    ) public {
        bytes32 policyId = keccak256(abi.encode(tokenAddress, streamId_));
        require(registeredPolicies[policyId] == address(0x0), "Join policy already registered");

        ERC20JoinPolicy instance = new ERC20JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            minRequiredBalance_,
            delegatedAccessRegistryAddress
        );
        address deployedPolicy = address(instance);
        erc20TokensToJoinPolicies[tokenAddress] = deployedPolicy;
        registeredPolicies[policyId] = deployedPolicy;
        emit Registered(
            tokenAddress,
            streamId_,
            deployedPolicy,
            policyId
        );
    }

    function registerERC1155Policy(
        address tokenAddress,
        uint256 tokenId,
        string memory streamId_,
        uint256[] memory tokenIds_,
        uint256[] memory minRequiredBalances_
    ) public {
        bytes32 policyId = keccak256(abi.encode(tokenAddress, tokenId, streamId_));
        require(registeredPolicies[policyId] == address(0x0), "Join policy already registered");

        ERC1155JoinPolicy instance = new ERC1155JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            tokenIds_,
            minRequiredBalances_,
            delegatedAccessRegistryAddress
        );

        address deployedPolicy = address(instance);
        erc1155TokensToJoinPolicies[tokenAddress][tokenId] = deployedPolicy;
        registeredPolicies[policyId] = deployedPolicy;
        emit Registered(
            tokenAddress,
            streamId_,
            deployedPolicy,
            policyId
        );
    }

    function registerERC721Policy(
        address tokenAddress,
        uint256 tokenId,
        string memory streamId_,
        uint256[] memory 
    ) public {
        bytes32 policyId = keccak256(abi.encode(tokenAddress, tokenId, streamId_));
        require(registeredPolicies[policyId] == address(0x0), "Join policy already registered");

        ERC721JoinPolicy instance = new ERC721JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            delegatedAccessRegistryAddress
        );

        address deployedPolicy = address(instance);
        erc721TokensToJoinPolicies[tokenAddress][tokenId] = deployedPolicy;
        registeredPolicies[policyId] = deployedPolicy;
        emit Registered(
            tokenAddress,
            streamId_,
            deployedPolicy,
            policyId
        );
    }
    // check compatibility with erc777
}