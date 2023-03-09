//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@streamr-contracts/network-contracts/contracts/StreamRegistry/StreamRegistryV3.sol";
import "../DelegatedAccessRegistry.sol";

abstract contract BaseJoinPolicy {
    string public streamId;

    StreamRegistryV3.PermissionType[] public permissions;

    StreamRegistryV3 private streamRegistry;
    DelegatedAccessRegistry public delegatedAccessRegistry;
    
    event Accepted (address indexed mainWallet, address delegatedWallet);
    event Revoked (address indexed mainWallet, address delegatedWallet);

    // owner => isAccepted
    mapping(address => bool) public accepted;

    bool public stakingEnabled;

    // tokenId => isTokenIdIncluded
    mapping(uint256 => bool) public tokenIds;
    uint256 public minRequiredBalance;

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

    modifier isWalletAccepted (address wallet) {
        require(accepted[wallet], "error_walletNotAccepted");
        _;
    }

    function _accept(address wallet) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.grantPermission(streamId, wallet, permissions[i]);
        }
        accepted[wallet] = true;
        delegatedAccessRegistry.addPolicyToWallet(address(this));
    }

    function accept(address mainWallet, address delegatedWallet) internal {
        _accept(mainWallet);
        _accept(delegatedWallet);
        emit Accepted(mainWallet, delegatedWallet);
    }

    function accept(address mainWallet) internal {
        _accept(mainWallet);
        emit Accepted(mainWallet, address(0x0));
    }

    function _revoke(address wallet) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.revokePermission(streamId, wallet, permissions[i]);
        }
        delegatedAccessRegistry.removePolicyFromWallet(address(this));
        accepted[wallet] = false;
    }

    function revoke(address mainWallet, address delegatedWallet) internal isWalletAccepted(mainWallet) isWalletAccepted(delegatedWallet) {
        _revoke(mainWallet);
        _revoke(delegatedWallet);
        emit Revoked(mainWallet, delegatedWallet);
    }

    function revoke(address mainWallet) internal isWalletAccepted(mainWallet) {
        _revoke(mainWallet);
        emit Revoked(mainWallet, address(0x0));
    }
}