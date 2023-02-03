// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./TokenGateFactory.sol";
import "../JoinPolicies/ERC1155JoinPolicy.sol";

contract ERC1155PolicyFactory is TokenGateFactory{

    constructor(
        address joinPolicyRegistryAddress_,
        address streamRegistryAddress_,
        address delegatedAccessRegistryAddress_
    ) TokenGateFactory(
        joinPolicyRegistryAddress_,
        streamRegistryAddress_,
        delegatedAccessRegistryAddress_   
    ){}

    function create(
        address tokenAddress,
        string memory streamId_,
        uint256 minRequiredBalance_,
        uint256[] memory tokenIds_,
        bool stakingEnabled_,
        StreamRegistryV3.PermissionType[] memory defaultPermissions_
    ) public override {
        ERC1155JoinPolicy instance = new ERC1155JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions_,
            tokenIds_,
            minRequiredBalance_,
            delegatedAccessRegistryAddress,
            stakingEnabled_
        );
        address deployedPolicy = address(instance);
        for (uint256 i = 0; i < tokenIds_.length; i++) {
             registry.register(
                tokenAddress,
                streamId_,
                deployedPolicy,
                tokenIds_[i],
                stakingEnabled_
            );
        }
    }
}