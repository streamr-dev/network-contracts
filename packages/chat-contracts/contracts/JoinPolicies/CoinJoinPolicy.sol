//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BaseJoinPolicy.sol";

abstract contract CoinJoinPolicy is BaseJoinPolicy {

    constructor(
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress,
        bool stakingEnabled_
    ) BaseJoinPolicy (
        streamRegistryAddress,
        delegatedAccessRegistryAddress,
        streamId_,
        permissions_,
        stakingEnabled_
    ) {
        require(minRequiredBalance_ > 0, "error_minReqBalanceGt0");
        minRequiredBalance = minRequiredBalance_;
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

    function depositStake(uint256 amount)
    virtual 
    public;

    function withdrawStake(uint256 amount) 
    virtual 
    public;

    modifier canJoin() virtual;


}