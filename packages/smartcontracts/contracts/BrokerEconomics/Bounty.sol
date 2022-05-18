// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

import "./IERC677.sol";
import "./IERC677Receiver.sol";

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./policies/IJoinPolicy.sol";
import "./policies/ILeavePolicy.sol";
import "./policies/IAllocationPolicy.sol";

// import "hardhat/console.sol";

/**
 * Stream Agreement holds the sponsors' tokens and allocates them to brokers
 */
contract Bounty is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable { //}, ERC2771Context {

    event StakeAdded(address indexed broker, uint addedWei, uint totalWei);
    event BrokerJoined(address indexed broker);
    event BrokerLeft(address indexed broker, uint returnedStakeWei);
    event StateChanged(State indexed newState);
    event SponsorshipReceived(address indexed sponsor, uint amount);

    // Emitted from the allocation policy
    event InsolvencyStarted(uint startTimeStamp);
    event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);

    mapping(address => bool) public approvedPolicies;
    IERC677 public token;
    address[] public joinPolicyAddresses;
    IAllocationPolicy public allocationPolicy;
    ILeavePolicy public leavePolicy;

    modifier isAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "error_mustBeAdminRole");
        _;
    }

    // State of the bounty contract
    // see https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Mechanisms
    enum State {
        NotInitialized,
        Closed,     // horizon < minHorizon and brokerCount fallen below minBrokerCount
        Warning,    // brokerCount > minBrokerCount, but horizon < minHorizon ==> brokers can leave without penalty
        Funded,     // horizon > minHorizon, but brokerCount still below minBrokerCount
        Running     // horizon > minHorizon and minBrokerCount <= brokerCount <= maxBrokerCount
    }

    function getState() public view returns (State) {
        if (address(allocationPolicy) == address(0) || address(leavePolicy) == address(0)) {
            return State.NotInitialized;
        }
        bool funded = getHorizon() >= globalData().minHorizonSeconds;
        bool manned = globalData().brokerCount >= globalData().minBrokerCount;

        if (funded) {
            return manned ? State.Running : State.Funded;
        } else {
            return manned ? State.Warning : State.Closed;
        }
    }

    // TODO: rename to GlobalStorage
    // storage variables available to all modules
    struct GlobalState {
        uint brokerCount;
        /** how much each broker has staked, if 0 broker is considered not part of bounty */
        mapping(address => uint) stakedWei;
        uint totalStakedWei;
        /** the timestamp a broker joined, to determine how long he has been a member,
            - option 1: must be set to 0 once broker leaves, must always be checked for 0
            - option 2: must be set to MAXINT once broker leaves, must be checked if < than now()*/
        mapping(address => uint) joinTimeOfBroker;
        uint unallocatedFunds;
        uint minHorizonSeconds;
        uint minBrokerCount;
    }

    function globalData() internal pure returns(GlobalState storage data) {
        bytes32 storagePosition = keccak256("agreement.storage.globalState");
        assembly {data.slot := storagePosition}
    }

    function getUnallocatedWei() public view returns(uint) {
        return globalData().unallocatedFunds;
    }

    function initialize(
        address newOwner,
        address tokenAddress,
        uint initialMinHorizonSeconds,
        uint initialMinBrokerCount,
        address trustedForwarderAddress
    ) public initializer {
        // __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, newOwner);
        token = IERC677(tokenAddress);
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        globalData().minHorizonSeconds = initialMinHorizonSeconds;
        globalData().minBrokerCount = initialMinBrokerCount;
    }

    /**
     * ERC677 token callback
     * If the data bytes contains an address, the incoming tokens are staked for that broker
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        require(_msgSender() == address(token), "error_onlyTokenContract");
        if (data.length == 20) {
            // shift 20 bytes (= 160 bits) to end of uint256 to make it an address => shift by 256 - 160 = 96
            // (this is what abi.encodePacked would produce)
            address stakeBeneficiary;
            assembly {
                stakeBeneficiary := shr(96, calldataload(data.offset))
            }
            _stake(stakeBeneficiary, amount);
        } else if (data.length == 32) {
            // assume the address was encoded by converting address -> uint -> bytes32 -> bytes (already in the least significant bytes)
            // (this is what abi.encode would produce)
            address stakeBeneficiary;
            assembly {
                stakeBeneficiary := calldataload(data.offset)
            }
            _stake(stakeBeneficiary, amount);
        } else {
            _addSponsorship(sender, amount);
        }
    }

    /** Stake by first calling ERC20.approve(bounty.address, amountTokenWei) then this function */
    function stake(address broker, uint amountTokenWei) external {
        token.transferFrom(_msgSender(), address(this), amountTokenWei);
        _stake(broker, amountTokenWei);
    }

    function _stake(address broker, uint amount) internal {
        // console.log("join at ", block.timestamp);
        if (globalData().stakedWei[broker] == 0) {
            // join the broker set
            for (uint i = 0; i < joinPolicyAddresses.length; i++) {
                IJoinPolicy joinPolicy = IJoinPolicy(joinPolicyAddresses[i]);
                moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.onJoin.selector, broker, amount), "error_joinPolicyOnJoin");
            }
            globalData().stakedWei[broker] += amount;
            globalData().brokerCount += 1;
            globalData().totalStakedWei += amount;
            globalData().joinTimeOfBroker[broker] = block.timestamp;
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onJoin.selector, broker), "error_allocationPolicyOnJoin");
            emit BrokerJoined(broker);
            // console.log("BrokerJoined");
        } else {
            // already joined, increasing stake
            globalData().stakedWei[broker] += amount;
            globalData().totalStakedWei += amount;

            // re-calculate the cumulative earnings
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onStakeIncrease.selector, broker), "error_stakeIncreaseFailed");
        }
        // TODO: if brokers.length > minBrokerCount { emit StateChanged(Running); }
    }

    function leave() external {
        _removeBroker(_msgSender());
    }

    /**
     * Broker stops servicing the stream and withdraws their stake + earnings.
     * Stake is returned only if there's not enough unallocated tokens to cover minHorizonSeconds.
     * If number of brokers falls below minBrokerCount, the stream is closed.
     */
    function _removeBroker(address broker) internal {
        uint stakedWei = globalData().stakedWei[broker];
        require(stakedWei > 0, "error_brokerNotStaked");

        // console.log("now", block.timestamp);
        // console.log("leaving: ", broker);
        uint penaltyWei = getLeavePenalty(broker);
        // console.log("  penalty ", penaltyWei);
        // console.log("  stake", stakedWei);
        uint allocation = getAllocation(broker);
        // console.log("  allocation", allocation);
        uint returnFunds = stakedWei - penaltyWei + allocation;
        // console.log("  returned", returnFunds);

        require(token.transfer(broker, returnFunds), "error_transfer");
        if (penaltyWei > 0) {
            // add forfeited stake to unallocated funds
            _addSponsorship(broker, penaltyWei);
        }

        // console.log("Unallocated: ", globalData().unallocatedFunds);
        globalData().brokerCount -= 1;
        globalData().totalStakedWei -= stakedWei;
        globalData().stakedWei[broker] = 0;
        globalData().joinTimeOfBroker[broker] = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onLeave.selector, broker), "error_brokerLeaveFailed");
        emit BrokerLeft(broker, returnFunds);
        // removeFromAddressArray(brokers, broker);

        // TODO: if (brokers.length < minBrokerCount) { emit StateChanged(Closed); }

    }

    /** Sponsor a stream by first calling ERC20.approve(agreement.address, amountTokenWei) then this function */
    function sponsor(uint amountTokenWei) external {
        token.transferFrom(_msgSender(), address(this), amountTokenWei);
        _addSponsorship(_msgSender(), amountTokenWei);
    }

    function _addSponsorship(address sponsorAddress, uint amountTokenWei) internal {
        // TODO: sweep also unaccounted tokens into unallocated funds?
        globalData().unallocatedFunds += amountTokenWei;
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onSponsor.selector, sponsorAddress, amountTokenWei), "error_sponsorFailed");
        emit SponsorshipReceived(sponsorAddress, amountTokenWei);
    }

    function getStake(address broker) external view returns (uint) {
        return globalData().stakedWei[broker];
    }

    function getMyStake() external view returns (uint) {
        return globalData().stakedWei[_msgSender()];
    }

    function setAllocationPolicy(address _allocationPolicyAddress, uint256 param) public isAdmin {
        allocationPolicy = IAllocationPolicy(_allocationPolicyAddress);
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.setParam.selector, param), "error_setAllocationPolicyFailed");
    }

    function setLeavePolicy(address _leaveAddress, uint256 param) public isAdmin {
        leavePolicy = ILeavePolicy(_leaveAddress);
        moduleCall(address(leavePolicy), abi.encodeWithSelector(leavePolicy.setParam.selector, param), "error_setLeavePolicyFailed");
    }

    function addJoinPolicy(address _joinPolicyAddress, uint256 param) public isAdmin {
        joinPolicyAddresses.push(_joinPolicyAddress);
        IJoinPolicy joinPolicy = IJoinPolicy(_joinPolicyAddress);
        moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.setParam.selector, param), "error_addJoinPolicyFailed");
    }

    function removeJoinPolicy(address _joinPolicyAddress) public isAdmin {
        removeFromAddressArray(joinPolicyAddresses, _joinPolicyAddress);
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

    /** Delegate-call ("library call") a module's method: it will use this Bounty's storage */
    function moduleCall(address moduleAddress, bytes memory callBytes, string memory defaultReason) internal {
        (bool success, bytes memory returndata) = moduleAddress.delegatecall(callBytes);
        if (!success) {
            if (returndata.length == 0) { revert(defaultReason); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
    }

    /**
     * Workaround to delegatecall view functions in modules
     * Suggested by https://ethereum.stackexchange.com/questions/82342/how-to-perform-delegate-call-inside-of-view-call-staticall
     * Pass the target module address in an "extra argument" to the getter function
     * @dev note the success value isn't parsed here; that would be double parsing here and then in the actual getter (below)
     * @dev instead, success is determined by the length of returndata: too long means it was a revert
     * @dev hopefully this whole kludge can be replaced with pure solidity once they get their delegate-static-call working
     */
    fallback(bytes calldata args) external returns (bytes memory) {
        require(msg.sender == address(this), "error_mustBeThis");

        // extra argument is 32 bytes per abi encoding; low 20 bytes are the module address
        uint len = args.length; // 4 byte selector + 32 bytes per argument
        address target = address(bytes20(args[len - 20 : len])); // grab the address
        bytes memory data = args[0 : len - 32]; // drop extra argument

        (bool success, bytes memory returndata) = target.delegatecall(data);
        if (!success) { assembly { revert(add(32, returndata), mload(returndata)) } } // re-revert the returndata as-is
        return returndata;
    }

    function moduleGet(bytes memory callBytes, string memory defaultReason) internal view returns (uint returnValue) {
        // trampoline through the above callback
        (bool success, bytes memory returndata) = address(this).staticcall(callBytes);
        if (!success) {
            if (returndata.length == 0) { revert(defaultReason); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
        // assume a successful call returns precisely one uint256, so take that out and drop the rest
        assembly { returnValue := mload(add(returndata, 32)) }
    }

    function getHorizon() public view returns(uint256 horizon) {
        return moduleGet(abi.encodeWithSelector(allocationPolicy.getHorizonSeconds.selector, address(allocationPolicy)), "error_getHorizonFailed");
    }

    function getAllocation(address broker) public view returns(uint256 allocation) {
        return moduleGet(abi.encodeWithSelector(allocationPolicy.calculateAllocation.selector, broker, address(allocationPolicy)), "error_getAllocationFailed");
    }

    function getLeavePenalty(address broker) public view returns(uint256 leavePenalty) {
        return moduleGet(abi.encodeWithSelector(leavePolicy.getLeavePenaltyWei.selector, broker, address(leavePolicy)), "error_getLeavePenaltyFailed");
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }
}
