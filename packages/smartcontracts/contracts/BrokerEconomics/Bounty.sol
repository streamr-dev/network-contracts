// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
pragma experimental ABIEncoderV2;

// import "@openzeppelin/contracts/access/AccessControl.sol";
// import "../metatx/ERC2771Context.sol";

import "./IERC677.sol";
import "./IERC677Receiver.sol";

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./policies/IJoinPolicy.sol";
import "./policies/ILeavePolicy.sol";
import "./policies/IAllocationPolicy.sol";

/**
 * Stream Agreement holds the sponsors' tokens and allocates them to brokers
 */
contract Bounty is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable { //}, ERC2771Context {

    // see https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Mechanisms
    enum State {
        Closed,     // horizon < minHorizon and brokerCount fallen below minBrokerCount
        Warning,    // brokerCount > minBrokerCount, but horizon < minHorizon ==> brokers can leave without penalty
        Funded,     // horizon > minHorizon, but brokerCount still below minBrokerCount
        Running     // horizon > minHorizon and minBrokerCount <= brokerCount <= maxBrokerCount
    }

    event StakeAdded(address indexed broker, uint addedWei, uint totalWei);
    event BrokerJoined(address indexed broker);
    event BrokerLeft(address indexed broker, uint returnedStakeWei);
    event StateChanged(State newState);
    event SponsorshipReceived(address indexed sponsor, uint amount);

    IERC677 public token;
    uint public allocationWeiPerSecond;
    uint public minimumStakeWei;
    uint public minBrokerCount;
    uint public maxBrokerCount;
    uint public minHorizonSeconds;

    // whole-stream state, see https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Global-State
    address[] public brokers;
    // uint public totalWeight; // TODO: weighting
    uint public totalStakeWei;
    uint public cumulativeUnitEarningsWei;  // CUE = how much earnings have accumulated per weight-unit
    uint public cueTimestamp;
    uint public totalSponsorshipsAtCueTimestamp;
    IJoinPolicy joinPolicy;
    ILeavePolicy leavePolicy;
    IAllocationPolicy allocationPolicy;
    // uint public startCue;           // CUE when StateChanged(Running)
    // uint public startTimestamp;     // block.timestamp when StateChanged(Running)

    // broker-specific state
    mapping(address => uint) public stakedWei;
    mapping(address => uint) public cueAtJoinWei;
    // mapping(address => uint) public weight; // TODO: weighting

    // constructor(
    //     address tokenAddress,
    //     uint initialAllocationWeiPerSecond,
    //     uint initialMinBrokerCount,
    //     uint initialMaxBrokerCount,
    //     uint initialMinimumStakeWei,
    //     uint initialMinHorizonSeconds
    // ) {
    //     token = IERC677(tokenAddress);
    //     allocationWeiPerSecond = initialAllocationWeiPerSecond;
    //     minBrokerCount = initialMinBrokerCount;
    //     maxBrokerCount = initialMaxBrokerCount;
    //     minimumStakeWei = initialMinimumStakeWei;
    //     minHorizonSeconds = initialMinHorizonSeconds;
    // }

    function initialize(address tokenAddress,
        uint initialAllocationWeiPerSecond,
        uint initialMinBrokerCount,
        uint initialMaxBrokerCount,
        uint initialMinimumStakeWei,
        uint initialMinHorizonSeconds,
        address _joinPolicy,
        address _leavePolicy,
        address _allocationPolicy,
        address trustedForwarderAddress) public initializer {
        // __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        token = IERC677(tokenAddress);
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        allocationWeiPerSecond = initialAllocationWeiPerSecond;
        minBrokerCount = initialMinBrokerCount;
        maxBrokerCount = initialMaxBrokerCount;
        minimumStakeWei = initialMinimumStakeWei;
        minHorizonSeconds = initialMinHorizonSeconds;
        joinPolicy = IJoinPolicy(_joinPolicy);
        leavePolicy = ILeavePolicy(_leavePolicy);
        allocationPolicy = IAllocationPolicy(_allocationPolicy);

    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function getState() public view returns (State) {
        bool funded = horizonSeconds() < minHorizonSeconds;
        bool manned = brokers.length >= minBrokerCount;
        return funded ? manned ? State.Running : State.Funded :
                        manned ? State.Warning : State.Closed;
    }

    function getBalances() internal view returns (uint owedWei, uint remainingWei) {
        owedWei = allocationWeiPerSecond * (block.timestamp - cueTimestamp); // solhint-disable-line not-rely-on-time
        remainingWei = token.balanceOf(address(this)) - totalStakeWei;
    }

    function withdrawableEarnings(address /*broker*/) public view returns (uint) {
        (uint owedWei, uint remainingWei) = getBalances();
        uint payableWei = remainingWei > owedWei ? owedWei : remainingWei;
        uint newUnitEarningsWei = payableWei / brokers.length; //  / totalWeight
        return cumulativeUnitEarningsWei + newUnitEarningsWei; //  ) * weight[broker];
    }

    /**
     * Tokens available to distribute to brokers as earnings.
     * When this goes to zero, the contract is bankrupt and stops giving earnings until further sponsorships are received.
     * New sponsorships pay first to brokers who were in contract while it was bankrupt.
     * TODO: should new sponsorships only pay new earnings and not "debt"?
     * Agreement will be closed only after enough brokers leave that there's less than minBrokerCount left
     */
    function unallocatedWei() public view returns (uint) {
        // (uint owedWei, uint remainingWei) = getBalances();
        // return remainingWei > owedWei ? remainingWei - owedWei : 0;
        return 4;
    }
    function a() public view returns (uint) {
        return 4;
    }

    /**
     * Horizon is how long time the currently unallocated funds cover.
     * Horizon can be increased by sponsoring this stream.
     */
    function horizonSeconds() public view returns (uint) {
        return 1 ether * unallocatedWei() / allocationWeiPerSecond;
    }

    function _stake(address broker, uint amountTokenWei) internal {
        stakedWei[broker] += amountTokenWei;
        totalStakeWei += amountTokenWei;
        emit StakeAdded(broker, amountTokenWei, stakedWei[broker]);
    }

    function _join(address broker) internal {
        brokers.push(broker);
        emit BrokerJoined(broker);
        cueAtJoinWei[broker] = cumulativeUnitEarningsWei;
        // TODO: if brokers.length > minBrokerCount { emit StateChanged(Running); }
    }

    /**
     * Can be called by anyone to update the cumulativeUnitEarningsWei
     */
    function refresh() public {
        (, uint totalSponsorships) = getBalances();
        uint newSponsorships = totalSponsorships - totalSponsorshipsAtCueTimestamp;
        emit SponsorshipReceived(msg.sender, newSponsorships);
    }

    /** Sponsor a stream by first calling ERC20.approve(agreement.address, amountTokenWei) then this function */
    function sponsor(uint amountTokenWei) external {
        require(token.transferFrom(msg.sender, address(this), amountTokenWei), "error_transfer");
        refresh();
    }

    /**
     * Broker needs to first add stake, OR give enough ERC20.allowance to stake up to minimumStakeWei
     */
    function join(address broker) external {
        require(brokers.length < maxBrokerCount, "error_maxBrokerCountLimit");

        if (stakedWei[broker] < minimumStakeWei) {
            uint missingStakeWei = minimumStakeWei - stakedWei[broker];
            require(token.transferFrom(msg.sender, address(this), missingStakeWei), "error_transfer");
            _stake(broker, missingStakeWei);
        }

        _join(broker);
    }

    /**
     * Stake for a broker by first calling ERC20.approve(agreement.address, amountTokenWei) then this function
     */
    function stake(address broker, uint amountTokenWei) public {
        require(token.transferFrom(msg.sender, address(this), amountTokenWei), "error_transfer");
        _stake(broker, amountTokenWei);

        // stakedWei is zero for non-joined brokers
        if (brokers.length < maxBrokerCount && stakedWei[broker] >= minimumStakeWei) {
            _join(broker);
        }
    }

    /**
     * Broker stops servicing the stream and withdraws their stake + earnings.
     * Stake is returned only if there's not enough unallocated tokens to cover minHorizonSeconds.
     * If number of brokers falls below minBrokerCount, the stream is closed.
     */
    function leave(address broker) external {
        bool returnStake = horizonSeconds() < minHorizonSeconds;
        if (returnStake) {
            require(token.transfer(broker, stakedWei[broker]), "error_transfer");
            emit BrokerLeft(broker, stakedWei[broker]);
        } else {
            // forfeited stake is added to unallocated tokens
            // unallocatedWei += stakedWei[broker]; // solhint-disable-line reentrancy
            emit SponsorshipReceived(broker, stakedWei[broker]);
            emit BrokerLeft(broker, 0);
        }
        delete stakedWei[broker];
        removeFromAddressArray(brokers, broker);

        // TODO: if (brokers.length < minBrokerCount) { emit StateChanged(Closed); }
    }

    /**
     * Interpret the incoming ERC677 token transfer as follows:
     * Sponsor a stream with ERC677.transferAndCall(agreement.address, amountTokenWei, "0x")
     * Stake for a broker (and join) with ERC677.transferAndCall(agreement.address, amountTokenWei, brokerAddress)
     */
    function onTokenTransfer(address, uint256 value, bytes calldata data) override external {
        require(msg.sender == address(token), "error_onlyTokenContract");
        if (data.length == 0) {
            refresh();
        } else if (data.length == 20) {
            address brokerAddress = address(bytes20(data));
            stake(brokerAddress, value);
        } else {
            revert("error_badErc677TransferData");
        }
    }

    // TODO: withdrawAll, withdrawTo, withdrawToSigned, ... consider a withdraw module?
    function withdraw(uint amountTokenWei) external {
        address broker = msg.sender;
        stakedWei[broker] -= amountTokenWei;
        totalStakeWei -= amountTokenWei;
        token.transfer(broker, amountTokenWei);
    }

    /**
     * Remove the listener from array by copying the last element into its place so that the arrays stay compact
     */
    function removeFromAddressArray(address[] storage array, address element) internal returns (bool success) {
        uint i = 0;
        while (i < array.length && array[i] != element) { i += 1; }
        return removeFromAddressArrayUsingIndex(array, i);
    }

    /**
     * Remove the listener from array by copying the last element into its place so that the arrays stay compact
     */
    function removeFromAddressArrayUsingIndex(address[] storage array, uint index) internal returns (bool success) {
        // TODO: if broker order in array makes a difference, either move remaining items back (linear time) or use heap (log time)
        if (index < 0 || index >= array.length) return false;
        if (index < array.length - 1) {
            array[index] = array[array.length - 1];
        }
        array.pop();
        return true;
    }
}
