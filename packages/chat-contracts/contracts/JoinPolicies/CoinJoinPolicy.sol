//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./BaseJoinPolicy.sol";

abstract contract CoinJoinPolicy is BaseJoinPolicy {
    // owner => tokenBalance
    mapping(address => uint256) public balances;
    
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
        if (stakingEnabled){
            _depositStake(minRequiredBalance);
        }
        accept(msg.sender);
    }

    function requestDelegatedJoin() 
        public
        isUserAuthorized() 
        canJoin() 
    {
        if (stakingEnabled){
            _depositStake(minRequiredBalance);
        }
        address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
        accept(msg.sender, delegatedWallet);
    }

    function requestLeave() public {
        if (stakingEnabled){
            _withdrawStake(minRequiredBalance);
        }
        revoke(msg.sender);
    }

    function requestDelegatedLeave() 
        public
        isUserAuthorized() 
    {
        if (stakingEnabled){
            _withdrawStake(minRequiredBalance);
        }
        address delegatedWallet = delegatedAccessRegistry.getDelegatedWalletFor(msg.sender);
        revoke(msg.sender, delegatedWallet);
    }

    function _depositStake(uint256 amount)
    virtual 
    internal;

    function _withdrawStake(uint256 amount) 
    virtual 
    internal;

    modifier canJoin() virtual;


}