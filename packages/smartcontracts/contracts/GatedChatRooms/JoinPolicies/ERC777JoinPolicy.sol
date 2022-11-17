//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC777/IERC777.sol";
import "@openzeppelin/contracts/token/ERC777/ERC777.sol";
import "@openzeppelin/contracts/utils/introspection/ERC1820Implementer.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../StreamRegistry/StreamRegistryV3.sol"; 
import "./JoinPolicy.sol";
import "../DelegatedAccessRegistry.sol";


contract ERC777JoinPolicy is JoinPolicy, ERC1820Implementer{
    IERC777 public token;

    IERC1820Registry private _erc1820 = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);
    bytes32 public constant TOKENS_RECIPIENT_INTERFACE_HASH = keccak256("ERC777TokensRecipient");
    bytes32 public constant TOKENS_SENDER_INTERFACE_HASH = keccak256("ERC777TokensSender");

    uint256 public minRequiredBalance;
    // owner => tokenBalance
    mapping(address => uint256) balances;

    constructor(
        address tokenAddress_,
        address streamRegistryAddress_,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_,
        uint256 minRequiredBalance_,
        address delegatedAccessRegistryAddress_,
        bool stakingEnabled_
    ) JoinPolicy (
        streamRegistryAddress_,
        delegatedAccessRegistryAddress_,
        streamId_,
        permissions_,
        stakingEnabled_
    ){
        require(minRequiredBalance_ > 0, "error_minReqBalanceGt0");
        token = IERC777(tokenAddress_);
        _erc1820.setInterfaceImplementer(address(this), TOKENS_RECIPIENT_INTERFACE_HASH, address(this));
        _erc1820.setInterfaceImplementer(address(this), TOKENS_SENDER_INTERFACE_HASH, address(this));
        minRequiredBalance = minRequiredBalance_;
    }

    modifier canJoin(uint256 /*tokenId_*/) override {
        require(token.balanceOf(msg.sender) >= minRequiredBalance, "error_notEnoughTokens");
        _;
    }

    function requestDelegatedJoin(
        address delegatedWallet,
        uint256 /*tokenId_*/
    ) 
        public
        override
        isUserAuthorized(delegatedWallet) 
        canJoin(0) 
    {
        accept(msg.sender, delegatedWallet);
    }

    function requestJoin(uint256 /*tokenId_*/) public override canJoin(0) {
        accept(msg.sender);
    }

    function stakeIn(
        uint256 amount,
        address delegatedWallet
    )
        public 
        isStakingEnabled()
        isUserAuthorized(delegatedWallet) 
        canJoin(0) 
    {
        token.operatorSend(msg.sender, address(this), amount, "", "");
        balances[msg.sender] = SafeMath.add(balances[msg.sender], amount);
        accept(msg.sender, delegatedWallet);
    }

    function stakeOut(
        uint256 amount,
        address delegatedWallet
    )
        public 
        isStakingEnabled()
        isUserAuthorized(delegatedWallet) 
    {
        token.send(msg.sender, amount, "");
        balances[msg.sender] = SafeMath.sub(balances[msg.sender], amount);
        if (balances[msg.sender] < minRequiredBalance) {
            revoke(msg.sender, delegatedWallet);
        }
    }
}
