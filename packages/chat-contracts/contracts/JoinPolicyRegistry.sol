//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@streamr-contracts/network-contracts/contracts/StreamRegistry/StreamRegistryV3.sol";
import "./JoinPolicies/ERC20JoinPolicy.sol";
import "./JoinPolicies/ERC721JoinPolicy.sol";
import "./JoinPolicies/ERC1155JoinPolicy.sol";

contract JoinPolicyRegistry {
    // policyId => JoinPolicy
    mapping(bytes32 => address) public registeredPoliciesById;

    // tokenAddress => mapping(tokenId => mapping(streamId => mapping(isStakingEnabled => JoinPolicy)))
    mapping(address => mapping(uint256 => mapping(string => mapping(bool => address)))) public policies;

    event Registered(
        address indexed tokenAddress, 
        string indexed streamId, 
        bool indexed isStakingEnabled,
        address policyAddress, 
        bytes32 policyId
    );

    constructor(){}

    function canBeRegistered(
        address tokenAddress_,
        string memory streamId_,
        uint256 tokenId_,
        bool stakingEnabled_
    ) public view returns (bytes32 policyId, bool) {
        policyId = keccak256(abi.encode(tokenAddress_, streamId_, tokenId_, stakingEnabled_));
        return (policyId, registeredPoliciesById[policyId] == address(0x0));
    }

    function register(
        address tokenAddress_,
        string memory streamId_,
        address deployedPolicy,
        uint256 tokenId_,
        bool stakingEnabled_
    ) public {
        (bytes32 policyId, bool canBeRegistered_) = canBeRegistered(tokenAddress_, streamId_, tokenId_, stakingEnabled_);
        require(canBeRegistered_, "error_alreadyRegistered");
        registeredPoliciesById[policyId] = deployedPolicy;

        policies[tokenAddress_][tokenId_][streamId_][stakingEnabled_] = deployedPolicy;
        emit Registered(
            tokenAddress_,
            streamId_,
            stakingEnabled_,
            deployedPolicy,
            policyId
        );
    }

    // use tokenId_ = 0 for ERC20 and ERC777
    function getPolicy(
        address tokenAddress_,
        uint256 tokenId_,
        string memory streamId_,
        bool stakingEnabled_
    ) public view returns (address) {
        return policies[tokenAddress_][tokenId_][streamId_][stakingEnabled_];
    }    
}