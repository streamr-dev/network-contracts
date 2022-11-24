//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../StreamRegistry/StreamRegistryV3.sol";
import "./ERC20JoinPolicy.sol";
import "./ERC721JoinPolicy.sol";
import "./ERC1155JoinPolicy.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/Initializable.sol";

contract JoinPolicyFactory is Initializable {

    address public streamRegistryAddress;
    StreamRegistryV3 public streamRegistry;
    StreamRegistryV3.PermissionType[] public defaultPermissions;

    address public delegatedAccessRegistryAddress;

    // erc20Token => mapping(streamId => ERC20JoinPolicy)
    mapping(address => mapping(string => address)) public erc20TokensToJoinPolicies;
    // erc721Token => mapping(tokenId => mapping(streamId => ERC721JoinPolicy))
    mapping(address => mapping(uint256 => mapping(string => address))) public erc721TokensToJoinPolicies;
    // erc1155Token => mapping(tokenId => mapping(streamId => ERC1155JoinPolicy))
    mapping(address => mapping(uint256 => mapping(string => address))) public erc1155TokensToJoinPolicies;
    // policyId => JoinPolicy
    mapping(bytes32 => address) public registeredPolicies;

    event Registered(
        address indexed tokenAddress,
        string indexed streamId,
        address policyAddress,
        bytes32 policyId
    );


    function initialize (
        address streamRegistryAddress_,
        StreamRegistryV3.PermissionType[] memory defaultPermissions_,
        address delegatedAccessRegistryAddress_
    ) public initializer {
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
        require(registeredPolicies[policyId] == address(0x0), "error_alreadyRegistered");

        ERC20JoinPolicy instance = new ERC20JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            minRequiredBalance_,
            delegatedAccessRegistryAddress
        );
        address deployedPolicy = address(instance);
        erc20TokensToJoinPolicies[tokenAddress][streamId_] = deployedPolicy;
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
        string memory streamId_
    ) public {
        bytes32 policyId = keccak256(abi.encode(tokenAddress, tokenId, streamId_));
        require(registeredPolicies[policyId] == address(0x0), "error_alreadyRegistered");

        ERC721JoinPolicy instance = new ERC721JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            delegatedAccessRegistryAddress
        );

        address deployedPolicy = address(instance);
        erc721TokensToJoinPolicies[tokenAddress][tokenId][streamId_] = deployedPolicy;
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
        uint256 minRequiredBalance_
    ) public {
        bytes32 policyId = keccak256(abi.encode(tokenAddress, tokenId, streamId_));
        require(registeredPolicies[policyId] == address(0x0), "error_alreadyRegistered");

        ERC1155JoinPolicy instance = new ERC1155JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions,
            tokenId,
            minRequiredBalance_,
            delegatedAccessRegistryAddress
        );

        address deployedPolicy = address(instance);
        erc1155TokensToJoinPolicies[tokenAddress][tokenId][streamId_] = deployedPolicy;
        registeredPolicies[policyId] = deployedPolicy;
        emit Registered(
            tokenAddress,
            streamId_,
            deployedPolicy,
            policyId
        );
    }
}
