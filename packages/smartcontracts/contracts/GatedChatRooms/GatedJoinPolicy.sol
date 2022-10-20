//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../StreamRegistry/StreamRegistryV3.sol"; 
import "./DelegatedAccessRegistry.sol";

contract GatedJoinPolicy{
    string public streamId;

    StreamRegistryV3.PermissionType[] public permissions;

    StreamRegistryV3 private streamRegistry;
    DelegatedAccessRegistry private delegatedAccessRegistry;
    
    event Accepted (address indexed mainWallet, address delegatedWallet);
    event Revoked (address indexed mainWallet, address delegatedWallet);

    bool public stakingEnabled;

    constructor (
        address streamRegistryAddress,
        address delegatedAccessRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        bool stakingEnabled_

    ) {
        streamRegistry = StreamRegistryV3(streamRegistryAddress);
        delegatedAccessRegistry = DelegatedAccessRegistry(delegatedAccessRegistryAddress);
        streamId = streamId_;
        permissions = permissions_;
        stakingEnabled = stakingEnabled_;

    }

    modifier isUserAuthorized(address delegatedWallet){
        require(delegatedAccessRegistry.isUserAuthorized(msg.sender, delegatedWallet), "error_notAuthorized");
        _;
    }

    modifier isStakingEnabled {
        require(stakingEnabled, "error_stakingDisabled");
        _;
    }

    function accept(address mainWallet, address delegatedWallet) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.grantPermission(streamId, mainWallet, permissions[i]);
            streamRegistry.grantPermission(streamId, delegatedWallet, permissions[i]);
        }
        emit Accepted(mainWallet, delegatedWallet);
    }

    function revoke(address mainWallet, address delegatedWallet) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.revokePermission(streamId, mainWallet, permissions[i]);
            streamRegistry.revokePermission(streamId, delegatedWallet, permissions[i]);
        }
        emit Revoked(mainWallet, delegatedWallet);
    }


}