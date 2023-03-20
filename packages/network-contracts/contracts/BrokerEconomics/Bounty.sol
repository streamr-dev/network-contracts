// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./IERC677.sol";
import "./IERC677Receiver.sol";
import "./IBroker.sol";
import "./BountyPolicies/IJoinPolicy.sol";
import "./BountyPolicies/ILeavePolicy.sol";
import "./BountyPolicies/IKickPolicy.sol";
import "./BountyPolicies/IAllocationPolicy.sol";
import "./StreamrConstants.sol";
// import "../../StreamRegistry/ERC2771ContextUpgradeable.sol";

// import "hardhat/console.sol";

/**
 * `Bounty` ("Stream Agreement") holds the sponsors' tokens and allocates them to brokers
 * Those tokens are the *bounty* that the *sponsor* puts on servicing the stream
 * *Brokers* that have `stake`d on the Bounty and receive *earnings* specified by the `IAllocationPolicy`
 * Brokers can also `unstake` and stop earning, signalling to stop servicing the stream.
 *  NB: If there's a flag on you (or by you) then some of your stake is committed on that flag, which prevents unstaking.
 *      If you really want to stop servicing the stream and are willing to lose the committed stake, you can `forceUnstake`
 * The tokens held by `Bounty` are tracked in several accounts:
 * - totalStakedWei: total amount of tokens staked by all brokers
 *  -> each broker has their `stakedWei`, part of which can be `committedStakeWei` if there are flags on/by them
 * - unallocatedFunds: part of the sponsorship that hasn't been paid out yet
 *  -> decides the `solventUntil` timestamp: more unallocated funds left means the `Bounty` is solvent for a longer time
 * - committedFundsWei: forfeited stakes that were committed to a flag by a past broker who `forceUnstake`d (or was kicked)
 *  -> should be zero when there are no active flags
 *
 * @dev It's important that whenever tokens are moved out (or unaccounted tokens detected) that they be accounted for
 *  either via _stake/_slash (to/from stake) or _addSponsorship (to unallocatedFunds)
 */
contract Bounty is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable { //}, ERC2771Context {

    event StakeUpdate(address indexed broker, uint stakedWei, uint allocatedWei);
    event BountyUpdate(uint totalStakeWei, uint unallocatedWei, uint projectedInsolvencyTime, uint32 brokerCount, bool isRunning);
    event FlagUpdate(address indexed flagger, address target, uint targetCommittedStake, uint result);
    event BrokerJoined(address indexed broker);
    event BrokerLeft(address indexed broker, uint returnedStakeWei);
    event SponsorshipReceived(address indexed sponsor, uint amount);
    event BrokerKicked(address indexed broker, uint slashedWei);
    event BrokerSlashed(address indexed broker, uint amountWei);

    // Emitted from the allocation policy
    event InsolvencyStarted(uint startTimeStamp);
    event InsolvencyEnded(uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    IERC677 public token;
    IJoinPolicy[] public joinPolicies;
    IAllocationPolicy public allocationPolicy;
    ILeavePolicy public leavePolicy;
    IKickPolicy public kickPolicy;

    // storage variables available to all modules
    struct GlobalStorage {
        StreamrConstants streamrConstants;
        mapping(address => uint) stakedWei; // how much each broker has staked, if 0 broker is considered not part of bounty
        mapping(address => uint) joinTimeOfBroker;
        mapping(address => uint) committedStakeWei; // how much can not be unstaked (during e.g. flagging)
        uint committedFundsWei; // committedStakeWei that has been forfeited but still needs to be tracked to e.g. pay the flag reviewers
        uint32 brokerCount;
        uint32 minBrokerCount;
        uint32 minHorizonSeconds;
        uint totalStakedWei;
        uint unallocatedFunds;
        uint minimumStakeWei;
    }

    function globalData() internal pure returns(GlobalStorage storage data) {
        bytes32 storagePosition = keccak256("bounty.storage.GlobalStorage");
        assembly { data.slot := storagePosition } // solhint-disable-line no-inline-assembly
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

    function getStake(address broker) external view returns (uint) {
        return globalData().stakedWei[broker];
    }

    function getMyStake() public view returns (uint) {
        return globalData().stakedWei[_msgSender()];
    }

    /**
     * You can't unstake the committed part or go below the minimum stake (by cashing out your stake),
     *   hence there is an individual limit for reduceStakeTo.
     * When joining, committed stake is zero, so the it's the same minimumStakeWei for everyone.
     */
    function minimumStakeOf(address broker) public view returns (uint minimumStakeWei) {
        GlobalStorage storage s = globalData();
        return max(s.committedStakeWei[broker], s.minimumStakeWei);
    }

    /**
     * Running means there's enough brokers signed up for the bounty,
     *  and the bounty should pay tokens to the brokers from the remaining sponsorship
     * See https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Mechanisms
     */
    function isRunning() public view returns (bool) {
        return globalData().brokerCount >= globalData().minBrokerCount;
    }

    /**
     * Funded means there's enough sponsorship to cover minHorizonSeconds of payments to brokers
     * DefaultLeavePolicy states brokers are free to leave an underfunded bounty
     */
    function isFunded() public view returns (bool) {
        return solventUntil() > block.timestamp + globalData().minHorizonSeconds; // solhint-disable-line not-rely-on-time
    }

    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(
        StreamrConstants streamrConstants,
        address newOwner,
        address tokenAddress,
        uint initialMinimumStakeWei,
        uint32 initialMinHorizonSeconds,
        uint32 initialMinBrokerCount,
        IAllocationPolicy initialAllocationPolicy,
        uint allocationPolicyParam
    ) public initializer {
        require(initialMinBrokerCount > 0, "error_minBrokerCountZero");
        require(initialMinimumStakeWei > 0, "error_minimumStakeZero");
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, newOwner);
        _setupRole(ADMIN_ROLE, newOwner);
        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE); // admins can make others admin, too
        token = IERC677(tokenAddress);
        globalData().minimumStakeWei = initialMinimumStakeWei;
        globalData().minHorizonSeconds = initialMinHorizonSeconds;
        globalData().minBrokerCount = initialMinBrokerCount;
        globalData().streamrConstants = StreamrConstants(streamrConstants);
        setAllocationPolicy(initialAllocationPolicy, allocationPolicyParam);
    }

    /**
     * ERC677 token callback
     * If the data bytes contains an address, the incoming tokens are staked for that broker
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        require(_msgSender() == address(token), "error_onlyDATAToken");
        if (data.length == 20) {
            // shift 20 bytes (= 160 bits) to end of uint256 to make it an address => shift by 256 - 160 = 96
            // (this is what abi.encodePacked would produce)
            address stakeBeneficiary;
            assembly { stakeBeneficiary := shr(96, calldataload(data.offset)) } // solhint-disable-line no-inline-assembly
            _stake(stakeBeneficiary, amount);
        } else if (data.length == 32) {
            // assume the address was encoded by converting address -> uint -> bytes32 -> bytes (already in the least significant bytes)
            // (this is what abi.encode would produce)
            address stakeBeneficiary;
            assembly { stakeBeneficiary := calldataload(data.offset) } // solhint-disable-line no-inline-assembly
            _stake(stakeBeneficiary, amount);
        } else {
            _addSponsorship(sender, amount);
        }
    }

    /**
     * Sponsor a stream by first calling DATA.approve(bounty.address, amountWei) then this function (2-step ERC20)
     *   or alternatively call DATA.transferAndCall(bounty.address, amountWei, "0x") (1-step ERC677)
     */
    function sponsor(uint amountWei) external {
        token.transferFrom(_msgSender(), address(this), amountWei);
        _addSponsorship(_msgSender(), amountWei);
    }

    function _addSponsorship(address sponsorAddress, uint amountWei) internal {
        // TODO: sweep also unaccounted tokens into unallocated funds?
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onSponsor.selector, sponsorAddress, amountWei), "error_sponsorFailed");
        globalData().unallocatedFunds += amountWei;
        emit SponsorshipReceived(sponsorAddress, amountWei);
        emit BountyUpdate(globalData().totalStakedWei, globalData().unallocatedFunds, solventUntil(), globalData().brokerCount, isRunning());
    }

    /**
     * Stake by first calling DATA.approve(bounty.address, amountWei) then this function (2-step ERC20)
     *   or alternatively call DATA.transferAndCall(bounty.address, amountWei, brokerAddress) (1-step ERC677)
     */
    function stake(address broker, uint amountWei) external {
        token.transferFrom(_msgSender(), address(this), amountWei);
        _stake(broker, amountWei);
    }

    function _stake(address broker, uint amountWei) internal {
        // console.log("join/stake at ", block.timestamp, broker, amountWei);
        GlobalStorage storage s = globalData();
        require(amountWei >= s.minimumStakeWei, "error_minimumStake");
        if (s.stakedWei[broker] == 0) {
           // console.log("Broker joins and stakes", broker, amountWei);
            for (uint i = 0; i < joinPolicies.length; i++) {
                IJoinPolicy joinPolicy = joinPolicies[i];
                moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.onJoin.selector, broker, amountWei), "error_joinPolicyOnJoin");
            }
            s.stakedWei[broker] += amountWei;
            s.brokerCount += 1;
            s.totalStakedWei += amountWei;
            s.joinTimeOfBroker[broker] = block.timestamp; // solhint-disable-line not-rely-on-time
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onJoin.selector, broker), "error_allocationPolicyOnJoin");
            emit BrokerJoined(broker);
        } else {
           // console.log("Broker already joined, increasing stake", broker, amountWei);
            s.stakedWei[broker] += amountWei;
            s.totalStakedWei += amountWei;
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onStakeChange.selector, broker, int(amountWei)), "error_stakeIncreaseFailed");
        }
        emit StakeUpdate(broker, s.stakedWei[broker], getAllocation(broker));
        emit BountyUpdate(s.totalStakedWei, s.unallocatedFunds, solventUntil(), s.brokerCount, isRunning());
    }

    /**
     * Get all the stake and allocations out
     * Throw if that's not possible due to open flags or leave penalty (e.g. leaving too early)
     */
    function unstake() public {
        address broker = _msgSender();
        uint penaltyWei = getLeavePenalty(broker);
        require(penaltyWei == 0, "error_leavePenalty");
        require(globalData().committedStakeWei[broker] == 0, "error_activeFlag");
        _removeBroker(broker);
    }

    /** Get both stake and allocations out, forfeitting leavePenalty and all stake that is committed to flags */
    function forceUnstake() public {
        address broker = _msgSender();
        uint penaltyWei = getLeavePenalty(broker);
        if (penaltyWei > 0) {
            _slash(broker, penaltyWei);
            _addSponsorship(address(this), penaltyWei);
        }
        _removeBroker(broker); // forfeits committed stake
    }

    /** Reduce your stake in the bounty without leaving */
    function reduceStakeTo(uint targetStakeWei) external {
        address broker = _msgSender();
        GlobalStorage storage s = globalData();
        require(targetStakeWei < s.stakedWei[broker], "error_cannotIncreaseStake");
        require(targetStakeWei >= minimumStakeOf(broker), "error_minimumStake");

        uint cashoutWei = s.stakedWei[broker] - targetStakeWei;
        _reduceStakeBy(broker, cashoutWei);
        token.transfer(broker, cashoutWei);

        emit StakeUpdate(broker, s.stakedWei[broker], getAllocation(broker));
        emit BountyUpdate(s.totalStakedWei, s.unallocatedFunds, solventUntil(), s.brokerCount, isRunning());
    }

    /**
     * Slashing moves tokens from a broker's stake to "free funds" (that are not in unallocatedFunds!)
     * @dev The caller MUST ensure those tokens are added to some other account, e.g. unallocatedFunds, via _addSponsorship
     * @dev do not slash more than the whole stake!
     **/
    function _slash(address broker, uint amountWei) internal {
        _reduceStakeBy(broker, amountWei);
        emit BrokerSlashed(broker, amountWei);
        if (broker.code.length > 0) {
            try IBroker(broker).onSlash() {} catch {}
        }
        emit StakeUpdate(broker, globalData().stakedWei[broker], getAllocation(broker));
    }

    /**
     * Kicking does what slashing does, plus removes the broker
     * @dev The caller MUST ensure those tokens are added to some other account, e.g. unallocatedFunds, via _addSponsorship
     * @dev do not slash more than the whole stake!
     */
    function _kick(address broker, uint slashingWei) internal {
        _reduceStakeBy(broker, slashingWei);
        _removeBroker(broker);
        emit BrokerKicked(broker, slashingWei);
        if (broker.code.length > 0) {
            try IBroker(broker).onKick() {} catch {}
        }
    }

    /**
     * Moves tokens from a broker's stake to "free funds" (that are not in unallocatedFunds!)
     * Does not actually send out tokens!
     * @dev The caller MUST ensure those tokens are added to some other account, e.g. unallocatedFunds, via _addSponsorship
     **/
    function _reduceStakeBy(address broker, uint amountWei) private {
        GlobalStorage storage s = globalData();
        assert(amountWei <= s.stakedWei[broker]); // should never happen! _slashing must be designed to not slash more than the whole stake
        s.stakedWei[broker] -= amountWei;
        s.totalStakedWei -= amountWei;
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onStakeChange.selector, broker, -int(amountWei)), "error_stakeChangeHandlerFailed");
    }

    /**
     * Broker stops servicing the stream and withdraws their stake + earnings.
     * If number of brokers falls below minBrokerCount, the bounty will no longer be "running" and the stream will be closed.
     * If broker had any committed stake, it is forfeited and accounted as committedFundsWei, under control of e.g. the VoteKickPolicy.
     */
    function _removeBroker(address broker) internal {
        GlobalStorage storage s = globalData();
        require(s.stakedWei[broker] > 0, "error_brokerNotStaked");
        // console.log("_removeBroker", broker);

        if (globalData().committedStakeWei[broker] > 0) {
            _slash(broker, globalData().committedStakeWei[broker]);
            globalData().committedFundsWei += globalData().committedStakeWei[broker];
            globalData().committedStakeWei[broker] = 0;
        }

        // send out both allocations and stake
        _withdraw(broker);
        uint paidOutStakeWei = s.stakedWei[broker];
        require(token.transferAndCall(broker, paidOutStakeWei, "stake"), "error_transfer");

        s.brokerCount -= 1;
        s.totalStakedWei -= paidOutStakeWei;
        delete s.stakedWei[broker];
        delete s.joinTimeOfBroker[broker];

        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onLeave.selector, broker), "error_leaveHandlerFailed");
        emit StakeUpdate(broker, 0, 0); // stake and allocation must be zero when the broker is gone
        emit BountyUpdate(s.totalStakedWei, s.unallocatedFunds, solventUntil(), s.brokerCount, isRunning());
        emit BrokerLeft(broker, paidOutStakeWei);
    }

    /** Get allocations out, leave stake in */
    function withdraw() external {
        address broker = _msgSender();
        uint stakedWei = globalData().stakedWei[broker];
        require(stakedWei > 0, "error_brokerNotStaked");

        uint payoutWei = _withdraw(broker);
        if (payoutWei > 0) {
            emit StakeUpdate(broker, globalData().stakedWei[broker], 0); // allocation will be zero after withdraw (see test)
            emit BountyUpdate(globalData().totalStakedWei, globalData().unallocatedFunds, solventUntil(), globalData().brokerCount, isRunning());
        }
    }

    function _withdraw(address broker) internal returns (uint payoutWei) {
        payoutWei = moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onWithdraw.selector, broker), "error_withdrawFailed");
        // console.log("withdraw ->", broker, payoutWei);
        if (payoutWei > 0) {
            require(token.transferAndCall(broker, payoutWei, "allocation"), "error_transfer");
        }
    }

    /** Start the flagging process to kick an abusive broker */
    function flag(address target) external {
        require(address(kickPolicy) != address(0), "error_notSupported");
        moduleCall(address(kickPolicy), abi.encodeWithSelector(kickPolicy.onFlag.selector, target), "error_kickPolicyFailed");
    }

    /** Peer reviewers vote on the flag */
    function voteOnFlag(address target, bytes32 voteData) external {
        require(address(kickPolicy) != address(0), "error_notSupported");
        moduleCall(address(kickPolicy), abi.encodeWithSelector(kickPolicy.onVote.selector, target, voteData), "error_kickPolicyFailed");
    }

    /** Read information about a flag, see the flag policy how that info is packed into the 256 bits of flagData */
    function getFlag(address target) external view returns (uint flagData) {
        require(address(kickPolicy) != address(0), "error_notSupported");
        return moduleGet(abi.encodeWithSelector(kickPolicy.getFlagData.selector, target, address(kickPolicy)), "error_kickPolicyFailed");
    }

    /////////////////////////////////////////
    // POLICY SETUP
    // This should happen during initialization and be done by the BountyFactory
    /////////////////////////////////////////

    function setAllocationPolicy(IAllocationPolicy newAllocationPolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        allocationPolicy = newAllocationPolicy;
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.setParam.selector, param), "error_setAllocationPolicyFailed");
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

    /////////////////////////////////////////
    // MODULE CALLS
    // moduleCall for transactions, moduleGet for view functions
    /////////////////////////////////////////
    /* solhint-disable */

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

    /* solhint-enable */

    function solventUntil() public view returns(uint256 horizon) {
        return moduleGet(abi.encodeWithSelector(allocationPolicy.getInsolvencyTimestamp.selector, address(allocationPolicy)), "error_getInsolvencyTimestampFailed");
    }

    function getAllocation(address broker) public view returns(uint256 allocation) {
        return moduleGet(abi.encodeWithSelector(allocationPolicy.calculateAllocation.selector, broker, address(allocationPolicy)), "error_getAllocationFailed");
    }

    function getLeavePenalty(address broker) public view returns(uint256 leavePenalty) {
        if (address(leavePolicy) == address(0)) { return 0; }
        return moduleGet(abi.encodeWithSelector(leavePolicy.getLeavePenaltyWei.selector, broker, address(leavePolicy)), "error_getLeavePenaltyFailed");
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }

    function max(uint a, uint b) internal pure returns (uint) {
        return a > b ? a : b;
    }
}
