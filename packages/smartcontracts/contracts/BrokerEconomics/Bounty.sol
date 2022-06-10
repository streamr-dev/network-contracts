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
import "./policies/IKickPolicy.sol";
import "./policies/IAllocationPolicy.sol";

// import "hardhat/console.sol";

/**
 * Stream Agreement holds the sponsors' tokens and allocates them to brokers
 */
contract Bounty is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable { //}, ERC2771Context {

    event StakeUpdate(address indexed broker, uint totalWei, uint allocatedWei);
    event BountyUpdate(uint totalStakeWei, uint unallocatedWei, uint projectedInsolvencyTime, uint32 memberCount, bool isRunning);

    event BrokerJoined(address indexed broker);
    event BrokerLeft(address indexed broker, uint returnedStakeWei);
    // event StateChanged(State indexed newState);
    // event SponsorshipReceived(address indexed sponsor, uint amount);
    event BrokerReported(address indexed broker, address indexed reporter);
    event BrokerKicked(address indexed broker, uint slashedWei);

    // Emitted from the allocation policy
    event InsolvencyStarted(uint startTimeStamp);
    event InsolvencyEnded(uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    IERC677 public token;
    IJoinPolicy[] public joinPolicies;
    IAllocationPolicy public allocationPolicy;
    ILeavePolicy public leavePolicy;
    IKickPolicy public kickPolicy;
    State public previousState;

    // storage variables available to all modules
    struct GlobalStorage {
        uint32 brokerCount;
        /** how much each broker has staked, if 0 broker is considered not part of bounty */
        mapping(address => uint) stakedWei;
        uint totalStakedWei;
        mapping(address => uint) withdrawnWei;
        mapping(address => uint) joinTimeOfBroker;
        uint unallocatedFunds;
        uint minHorizonSeconds;
        uint minBrokerCount;
    }

    function globalData() internal pure returns(GlobalStorage storage data) {
        bytes32 storagePosition = keccak256("agreement.storage.GlobalStorage");
        assembly {data.slot := storagePosition}
    }

    function getUnallocatedWei() public view returns(uint) {
        return globalData().unallocatedFunds;
    }

    function getBrokerCount() public view returns(uint) {
        return globalData().brokerCount;
    }

    function isAdmin(address a) public view returns(bool) {
        return hasRole(ADMIN_ROLE, a);
    }

    // State of the bounty contract
    // see https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Mechanisms
    enum State {
        NotInitialized, // horizon = how much longer there are unallocated funds
        Closed,     // horizon < minHorizon and brokerCount fallen below minBrokerCount
        Warning,    // brokerCount > minBrokerCount, but horizon < minHorizon ==> brokers can leave without penalty, expecting a top-up
        Funded,     // horizon > minHorizon, but brokerCount still below minBrokerCount, waiting for brokers
        Running     // horizon > minHorizon and minBrokerCount <= brokerCount <= maxBrokerCount
    }

    // TODO: should this be decided by a module?
    function isRunning() public view returns (bool) {
        return globalData().brokerCount >= globalData().minBrokerCount;
    }

    function getState() public view returns (State) {
        if (address(allocationPolicy) == address(0) || address(leavePolicy) == address(0)) {
            return State.NotInitialized;
        }
        bool funded = solventUntil() > block.timestamp + globalData().minHorizonSeconds;

        if (isRunning()) {
            return funded ? State.Running : State.Warning;
        } else {
            return funded ? State.Funded : State.Closed;
        }
    }

    /** See if the state has changed, emit a StateChanged event */
    function checkStateChange() public {
        State currentState = getState();
        // if (currentState != previousState) {
        //     emit StateChanged(currentState);
        // }
        previousState = currentState;
    }

    function initialize(
        address newOwner,
        address tokenAddress,
        uint initialMinHorizonSeconds,
        uint initialMinBrokerCount,
        address trustedForwarderAddress
    ) public initializer {
        require(initialMinBrokerCount > 0, "error_minBrokerCountZero");
        // __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, newOwner);
        _setupRole(ADMIN_ROLE, newOwner);
        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE); // admins can make others admin, too
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
        // console.log("join/stake at ", block.timestamp);
        require(amount > 0, "error_cannotStakeZero");
        GlobalStorage storage s = globalData();
        if (s.stakedWei[broker] == 0) {
            // console.log("Broker joins and stakes", broker, amount);
            for (uint i = 0; i < joinPolicies.length; i++) {
                IJoinPolicy joinPolicy = joinPolicies[i];
                moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.onJoin.selector, broker, amount), "error_joinPolicyOnJoin");
            }
            s.stakedWei[broker] += amount;
            s.brokerCount += 1;
            s.totalStakedWei += amount;
            s.joinTimeOfBroker[broker] = block.timestamp;
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onJoin.selector, broker), "error_allocationPolicyOnJoin");
            emit BrokerJoined(broker);
        } else {
            // console.log("Broker already joined, increasing stake", broker, amount);
            s.stakedWei[broker] += amount;
            s.totalStakedWei += amount;

            // re-calculate the cumulative earnings
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onStakeIncrease.selector, broker, amount), "error_stakeIncreaseFailed");
        }
        checkStateChange();
        emit StakeUpdate(broker, s.stakedWei[broker], getAllocation(broker));
        emit BountyUpdate(s.totalStakedWei, s.unallocatedFunds, solventUntil(), s.brokerCount, isRunning());
    }

    function leave() external {
        // console.log("timestamp now", block.timestamp);
        address broker = _msgSender();
        uint penaltyWei = getLeavePenalty(broker);
        _removeBroker(broker, penaltyWei);
    }

    /**
     * Broker stops servicing the stream and withdraws their stake + earnings.
     * If number of brokers falls below minBrokerCount, the stream is closed.
     */
    function _removeBroker(address broker, uint penaltyWei) internal {
        uint stakedWei = globalData().stakedWei[broker];
        require(stakedWei > 0, "error_brokerNotStaked");

        // console.log("leaving:", broker);
        // console.log("  stake   ", stakedWei);
        // console.log("  penalty ", penaltyWei);
        uint returnFunds = stakedWei - penaltyWei;
        // console.log("  returned", returnFunds);

        // TODO: transferAndCall
        require(token.transfer(broker, returnFunds), "error_transfer");
        if (penaltyWei > 0) {
            // add forfeited stake to unallocated funds
            _addSponsorship(broker, penaltyWei);
        }

        _withdraw(broker);

        GlobalStorage storage s = globalData();
        s.brokerCount -= 1;
        s.totalStakedWei -= stakedWei;
        delete s.stakedWei[broker];
        delete s.joinTimeOfBroker[broker];
        delete s.withdrawnWei[broker];
        // console.log("Unallocated: ", s.unallocatedFunds);

        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onLeave.selector, broker), "error_brokerLeaveFailed");
        emit StakeUpdate(broker, s.stakedWei[broker], getAllocation(broker));
        emit BountyUpdate(globalData().totalStakedWei, globalData().unallocatedFunds, solventUntil(), globalData().brokerCount, isRunning());
        emit BrokerLeft(broker, returnFunds);
        checkStateChange();
        // removeFromAddressArray(brokers, broker);
    }

    function withdraw() external {
        _withdraw(_msgSender());
    }

    function _withdraw(address broker) internal {
        uint stakedWei = globalData().stakedWei[broker];
        require(stakedWei > 0, "error_brokerNotStaked");

        uint allocation = getAllocation(broker);
        GlobalStorage storage s = globalData();
        uint payoutWei = allocation - s.withdrawnWei[broker];
        s.withdrawnWei[broker] += allocation;
        // console.log("  allocation", allocation);
        // TODO: transferAndCall
        require(token.transfer(broker, payoutWei), "error_transfer");
        emit StakeUpdate(broker, s.stakedWei[broker], getAllocation(broker));
        emit BountyUpdate(globalData().totalStakedWei, globalData().unallocatedFunds, solventUntil(), globalData().brokerCount, isRunning());
    }

    /** Sponsor a stream by first calling ERC20.approve(agreement.address, amountTokenWei) then this function */
    function sponsor(uint amountTokenWei) external {
        token.transferFrom(_msgSender(), address(this), amountTokenWei);
        _addSponsorship(_msgSender(), amountTokenWei);
    }

    function _addSponsorship(address sponsorAddress, uint amountTokenWei) internal {
        // TODO: sweep also unaccounted tokens into unallocated funds?
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onSponsor.selector, sponsorAddress, amountTokenWei), "error_sponsorFailed");
        globalData().unallocatedFunds += amountTokenWei;
        checkStateChange();
        emit BountyUpdate(globalData().totalStakedWei, globalData().unallocatedFunds, solventUntil(), globalData().brokerCount, isRunning());
    }

    function getStake(address broker) external view returns (uint) {
        return globalData().stakedWei[broker];
    }

    function getMyStake() external view returns (uint) {
        return globalData().stakedWei[_msgSender()];
    }

    function report(address broker) external {
        // console.log("Reporting", broker);
        address reporter = _msgSender();
        emit BrokerReported(broker, reporter);
        uint penaltyWei = moduleCall(address(kickPolicy), abi.encodeWithSelector(kickPolicy.onReport.selector, broker, reporter), "error_kickPolicyFailed");
        if (penaltyWei > 0) {
            // console.log("Kicking", broker);
            _removeBroker(broker, penaltyWei);
            emit BrokerKicked(broker, penaltyWei);
        }
    }

    /////////////////////////////////////////
    // POLICY SETUP
    // This should happen during initialization and be done by the BountyFactory
    /////////////////////////////////////////

    function setAllocationPolicy(IAllocationPolicy newAllocationPolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        allocationPolicy = newAllocationPolicy;
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.setParam.selector, param), "error_setAllocationPolicyFailed");
        checkStateChange();
    }

    function setLeavePolicy(ILeavePolicy newLeavePolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        leavePolicy = newLeavePolicy;
        moduleCall(address(leavePolicy), abi.encodeWithSelector(leavePolicy.setParam.selector, param), "error_setLeavePolicyFailed");
    }

    function setKickPolicy(IKickPolicy newKickPolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        kickPolicy = newKickPolicy;
        moduleCall(address(kickPolicy), abi.encodeWithSelector(kickPolicy.setParam.selector, param), "error_setKickPolicyFailed");
    }

    function addJoinPolicy(IJoinPolicy newJoinPolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        joinPolicies.push(newJoinPolicy);
        moduleCall(address(newJoinPolicy), abi.encodeWithSelector(newJoinPolicy.setParam.selector, param), "error_addJoinPolicyFailed");
    }

    // TODO: remove
    // function removeJoinPolicy(address _joinPolicyAddress) public adminOnly {
    //     removeFromAddressArray(joinPolicies, _joinPolicyAddress);
    // }

    // TODO: remove
    /**
     * Remove the listener from array by copying the last element into its place so that the arrays stay compact
     */
    // function removeFromAddressArray(address[] storage array, address element) internal returns (bool success) {
    //     uint i = 0;
    //     while (i < array.length && array[i] != element) { i += 1; }
    //     return removeFromAddressArrayUsingIndex(array, i);
    // }

    // TODO: remove
    /**
     * Remove the listener from array by copying the last element into its place so that the arrays stay compact
     */
    // function removeFromAddressArrayUsingIndex(address[] storage array, uint index) internal returns (bool success) {
    //     // TODO: if broker order in array makes a difference, either move remaining items back (linear time) or use heap (log time)
    //     if (index < 0 || index >= array.length) return false;
    //     if (index < array.length - 1) {
    //         array[index] = array[array.length - 1];
    //     }
    //     array.pop();
    //     return true;
    // }

    /////////////////////////////////////////
    // MODULE CALLS
    // moduleCall for transactions, moduleGet for view functions
    /////////////////////////////////////////

    /**
     * Delegate-call ("library call") a module's method: it will use this Bounty's storage
     * When calling from a view function (staticcall context), use moduleGet instead
     */
    function moduleCall(address moduleAddress, bytes memory callBytes, string memory defaultReason) internal returns (uint returnValue) {
        (bool success, bytes memory returndata) = moduleAddress.delegatecall(callBytes);
        if (!success) {
            if (returndata.length == 0) { revert(defaultReason); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
        // assume a successful call returns precisely one uint256 or nothing, so take that out and drop the rest
        // for the function that return nothing, the returnValue will just be garbage
        assembly { returnValue := mload(add(returndata, 32)) }
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

    /** Call a module's view function (staticcall) */
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

    function solventUntil() public view returns(uint256 horizon) {
        return moduleGet(abi.encodeWithSelector(allocationPolicy.getInsolvencyTimestamp.selector, address(allocationPolicy)), "error_getInsolvencyTimestampFailed");
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
