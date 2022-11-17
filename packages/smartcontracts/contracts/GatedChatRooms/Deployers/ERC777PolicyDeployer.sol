// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./TokenGateDeployer.sol";
import "../JoinPolicies/ERC777JoinPolicy.sol";

contract ERC777PolicyDeployer is TokenGateDeployer{

    constructor(
        address joinPolicyRegistryAddress_,
        address streamRegistryAddress_,
        address delegatedAccessRegistryAddress_
    ) TokenGateDeployer(
        joinPolicyRegistryAddress_,
        streamRegistryAddress_,
        delegatedAccessRegistryAddress_   
    ){}

    function deploy(
        address tokenAddress,
        string memory streamId_,
        uint256 minRequiredBalance_,
        uint256 /*tokenId_*/,
        bool stakingEnabled_,
        StreamRegistryV3.PermissionType[] memory defaultPermissions_
    ) public override {
        ERC777JoinPolicy instance = new ERC777JoinPolicy(
            tokenAddress,
            streamRegistryAddress,
            streamId_,
            defaultPermissions_,
            minRequiredBalance_,
            delegatedAccessRegistryAddress,
            stakingEnabled_
        );
        address deployedPolicy = address(instance);
        registry.register(
            tokenAddress,
            streamId_,
            deployedPolicy,
            0, // tokenId = 0 for ERC777
            stakingEnabled_
        );
    }
}