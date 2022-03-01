// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
// import "../metatx/ERC2771Context.sol";

import "./StreamBrokerRegistry.sol";

import "../IERC677.sol";
import "../IERC677Receiver.sol";
import "./IAddBrokerListener.sol";
import "./IRemoveBrokerListener.sol";
import "./policies/IJoinPolicy.sol";
import "./policies/ILeavePolicy.sol";
import "./policies/IAllocationPolicy.sol";

/**
 * Stream Agreement holds the sponsors' tokens and allocates them to brokers
 */
contract StreamAgreement is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable, IAddBrokerListener, IRemoveBrokerListener { //}, ERC2771Context {
    StreamBrokerRegistry public streamBrokerRegistry; // TODO: call it just registry if no other registries are directly referenced
    IERC677 public token;

    IJoinPolicy public joinPolicy;
    ILeavePolicy public leavePolicy;
    IAllocationPolicy public allocationPolicy;

    // default parameters, TODO: add setters for owner after the model is set in stone
    uint public defaultAllocationPerEpochWei = 1 ether;
    uint public defaultMinBrokerCount = 3;
    uint public defaultMaxBrokerCount = 5;

    // stream-specific state
    // see https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Global-State
    mapping(string => uint) public unallocatedWei;

    // stream-specific overrides to parameters
    mapping(string => uint) public allocationPerEpochWei;
    mapping(string => uint) public maxBrokerCount;

    // broker-specific state
    mapping(address => uint) public stakedWei;

    // constructor(
    //     address streamBrokerRegistryAddress,
    //     address tokenAddress
    //     // address nodeRegistryAddress,
    //     // address trustedForwarderAddress
    // ) { // ERC2771Context(trustedForwarderAddress) {
    //     streamBrokerRegistry = StreamBrokerRegistry(streamBrokerRegistryAddress);
    //     token = IERC677(tokenAddress);
    //     // nodeRegistry = NodeRegistry(nodeRegistryAddress);
    // }

    // function initialize(address streamBrokerRegistryAddress, address tokenAddress, address trustedForwarderAddress) public initializer {
    function initialize(address streamBrokerRegistryAddress, address tokenAddress) public initializer {
        // __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        streamBrokerRegistry = StreamBrokerRegistry(streamBrokerRegistryAddress);
        token = IERC677(tokenAddress);
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    /**
     * Horizon is the number of "epochs" that the currently unallocated funds cover.
     * Horizon can be increased by sponsoring a stream.
     * @return horizonWei the length of the horizon scaled by 10^18, similar to tokens
     */
    function horizon(string calldata streamId) public view returns (uint horizonWei) {
        uint tokensWei = unallocatedWei[streamId];
        uint allocWei = allocationPerEpochWei[streamId];
        if (allocWei == 0) { allocWei = defaultAllocationPerEpochWei; }
        horizonWei = 1 ether * tokensWei / allocWei;
    }

    /** Called by StreamBrokerRegistry when a broker wants to join (prevent join by throwing) */
    function onBrokerAdded(string calldata streamId, address broker) override external {
        uint brokerC = streamBrokerRegistry.brokerCount(streamId);
        uint maxBrokerC = maxBrokerCount[streamId];
        if (maxBrokerC == 0) { maxBrokerC = defaultMaxBrokerCount; }
        require(brokerC < maxBrokerC, "error_maxBrokerCountLimit");

        // TODO: check if new broker has staked

    }

    /** Called by StreamBrokerRegistry when a broker wants to leave (can NOT prevent parting) */
    function onBrokerRemoved(string calldata streamId, address broker) override external {
        // TODO: check if broker can keep its stake
    }

    /**
     * Interpret the incoming ERC677 token transfer as follows:
     * Sponsor a stream with ERC677.transferAndCall(agreement.address, amountTokenWei, streamId)
     * Stake for a broker with ERC677.transferAndCall(agreement.address, amountTokenWei, brokerAddress)
     */
    function onTokenTransfer(address, uint256 value, bytes calldata data) override external {
        require(msg.sender == address(token), "error_onlyTokenContract");
        string calldata streamId = string(data);
        if (streamBrokerRegistry.streamExists(streamId)) {
            _sponsor(streamId, value);
        } else if (data.length == 20) {
            address brokerAddress = address(bytes20(data));
            _stake(brokerAddress, value);
        } else {
            revert("error_badErc677TransferData");
        }
    }

    /** Sponsor a stream by first calling ERC20.approve(agreement.address, amountTokenWei) then this function */
    function sponsor(string calldata streamId, uint amountTokenWei) external {
        require(token.transferFrom(msg.sender, address(this), amountTokenWei), "error_transfer");
        _sponsor(streamId, amountTokenWei);
    }

    /** Stake for a broker by first calling ERC20.approve(agreement.address, amountTokenWei) then this function */
    function stake(address broker, uint amountTokenWei) external {
        require(token.transferFrom(msg.sender, address(this), amountTokenWei), "error_transfer");
        _stake(broker, amountTokenWei);
    }

    function _sponsor(string calldata streamId, uint amountTokenWei) internal {
        unallocatedWei[streamId] += amountTokenWei;
    }

    function _stake(address broker, uint amountTokenWei) internal {
        stakedWei[broker] += amountTokenWei;
    }

    // TODO: withdrawAll, withdrawTo, withdrawToSigned, ... consider a withdraw module?
    function withdraw(uint amountTokenWei) external {
        address broker = msg.sender;
        stakedWei[broker] -= amountTokenWei;
        token.transfer(broker, amountTokenWei);
    }
}
