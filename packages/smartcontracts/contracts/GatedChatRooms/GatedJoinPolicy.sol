//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../StreamRegistry/StreamRegistryV3.sol"; 

contract GatedJoinPolicy is Ownable{
    string public streamId;

    StreamRegistryV3.PermissionType[] public permissions;

    StreamRegistryV3 public streamRegistry;

    event Accepted (address indexed user);

    constructor (
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_
    ) Ownable() {
        streamRegistry = StreamRegistryV3(streamRegistryAddress);

        streamId = streamId_;
        permissions = permissions_;
    }


    function accept(address main, address delegated) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.grantPermission(streamId, main, permissions[i]);
            streamRegistry.grantPermission(streamId, delegated, permissions[i]);
        }
        emit Accepted(main);
        emit Accepted(delegated);
    }
}