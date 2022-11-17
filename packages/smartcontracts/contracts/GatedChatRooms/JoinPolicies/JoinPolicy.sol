//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../../StreamRegistry/StreamRegistryV3.sol"; 
import "../DelegatedAccessRegistry.sol";

abstract contract JoinPolicy{
    string public streamId;

    StreamRegistryV3.PermissionType[] public permissions;

    StreamRegistryV3 private streamRegistry;
    DelegatedAccessRegistry public delegatedAccessRegistry;
    
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

    modifier isUserAuthorized {
        require(delegatedAccessRegistry.isMainWallet(msg.sender), "error_notAuthorized");
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

    function accept(address mainWallet) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.grantPermission(streamId, mainWallet, permissions[i]);
        }
        emit Accepted(mainWallet, address(0x0));
    }

    function revoke(address mainWallet, address delegatedWallet) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.revokePermission(streamId, mainWallet, permissions[i]);
            streamRegistry.revokePermission(streamId, delegatedWallet, permissions[i]);
        }
        emit Revoked(mainWallet, delegatedWallet);
    }

    function revoke(address mainWallet) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.revokePermission(streamId, mainWallet, permissions[i]);
        }
        emit Revoked(mainWallet, address(0x0));
    }

    function requestJoin() public canJoin() {
        accept(msg.sender);
    }

    function requestDelegatedJoin() 
        public
        isUserAuthorized() 
        canJoin() 
    {
        address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
        accept(msg.sender, delegatedWallet);
    }

    modifier canJoin() virtual;

}