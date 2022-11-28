// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../JoinPolicyRegistry.sol";

abstract contract TokenGateDeployer {
    JoinPolicyRegistry public registry;

    address public streamRegistryAddress;
    StreamRegistryV3 public streamRegistry;

    address public delegatedAccessRegistryAddress;

    constructor(
        address joinPolicyRegistryAddress_,
        address streamRegistryAddress_,
        address delegatedAccessRegistryAddress_
    ) {
        registry = JoinPolicyRegistry(joinPolicyRegistryAddress_);
        streamRegistryAddress = streamRegistryAddress_;
        delegatedAccessRegistryAddress = delegatedAccessRegistryAddress_;
    }

    function deploy(
        address tokenAddress,
        string memory streamId_,
        uint256 minRequiredBalance_,
        uint256 tokenId_,
        bool stakingEnabled_,
        StreamRegistryV3.PermissionType[] memory defaultPermissions_
    ) public virtual;
}