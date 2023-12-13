// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "./IERC677.sol";
import "./IERC677Receiver.sol";
import "./IOperator.sol";
import "./IVoterRegistry.sol";
import "./OperatorPolicies/IDelegationPolicy.sol";
import "./OperatorPolicies/IExchangeRatePolicy.sol";
import "./OperatorPolicies/IUndelegationPolicy.sol";

import "./OperatorPolicies/INodeModule.sol";
import "./OperatorPolicies/IQueueModule.sol";
import "./OperatorPolicies/IStakeModule.sol";

import "./StreamrConfig.sol";
import "./Sponsorship.sol";
import "./SponsorshipFactory.sol";

import "../StreamRegistry/IStreamRegistryV4.sol";

/**
 * Operator contract receives and holds the delegators' DATA tokens.
 * Operator contract also is an ERC20 token that each delegator receives, and can swap back to DATA when they undelegate.
 *
 * The operator (`owner()`) stakes the delegated DATA to Sponsorships of streams, and the operator's nodes will perform work brokering those streams.
 * Earnings from this work are split when they're withdrawn: operator and protocol take their cuts, and the rest inflates the value of the operator token.
 * When a delegator undelegates, the DATA tokens they receive in addition to what they delegated originally are their share of the profits.
 *
 * At the undelegation moment, the contract might not have enough DATA to pay out immediately. In that case, the undelegation is queued.
 * Always when new DATA tokens arrive, they are first used for paying out the queue, in order. This is why the payment may happen in many parts.
 * The operator is allowed to stake available DATA to Sponsorships only when the queue is empty, that is, all undelegations have been paid out.
 *
 * The operator is required to keep a self-delegation in this contract. It is the operator's "skin in the game",
 *   and will also be burned if the operator gets slashed in a Sponsorship (see `_slashSelfDelegation()`).
 * This way, as long as there's self-delegation, the delegators will not pay for the penalties the operator receives.
 * When a slashing happens, just enough self-delegation is burned that the DATA value of all delegations remains the same.
 *
 * Only when the operator has unstaked from all Sponsorships, can they self-undelegate freely from this contract.
 * If there's not enough self-delegation, new delegators are rejected, and new staking is disabled.
 * The same restriction applies to transferring the operator contract token: if the recipient is not a delegator already, then the self-delegation check is applied.
 *
 * Second restriction is that no delegator should hold less tokens than a special "minimum delegation amount".
 * This is to defend against sand delegations enabling extreme token exchange rates and rounding error exploits.
 *
 * `DEFAULT_ADMIN_ROLE()` can set the modules and policies, and it should only be held by the OperatorFactory during deployment.
 *
 * @dev DATA token balance of the contract === the "free funds" available for staking,
 * @dev   so there's no need to track "unstaked tokens" separately from delegations (like Sponsorships must track stakes separately from earnings and remaining sponsorship)
 */
contract Operator is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable, ERC20Upgradeable, IOperator {

    // delegator events (initiated by anyone)
    event Delegated(address indexed delegator, uint amountDataWei);
    event Undelegated(address indexed delegator, uint amountDataWei);
    event BalanceUpdate(address indexed delegator, uint balanceWei, uint totalSupplyWei, uint dataValueWithoutEarnings); // Operator token tracking event
    event QueuedDataPayout(address indexed delegator, uint amountWei, uint queueIndex);
    event QueueUpdated(address indexed delegator, uint amountWei, uint queueIndex);

    // sponsorship events (initiated by CONTROLLER_ROLE)
    event Staked(Sponsorship indexed sponsorship);
    event Unstaked(Sponsorship indexed sponsorship);
    event StakeUpdate(Sponsorship indexed sponsorship, uint stakedWei);
    event OperatorValueUpdate(uint totalStakeInSponsorshipsWei, uint dataTokenBalanceWei); // DATA token tracking event (staked - slashed)
    event Profit(uint valueIncreaseWei, uint indexed operatorsCutDataWei, uint indexed protocolFeeDataWei);
    event Loss(uint valueDecreaseWei);

    // node events (initiated by nodes)
    event Heartbeat(address indexed nodeAddress, string jsonData);
    event ReviewRequest(Sponsorship indexed sponsorship, address indexed targetOperator, uint voteStartTimestamp, uint voteEndTimestamp, string flagMetadata);

    // operator admin events
    event NodesSet(address[] nodes);
    event MetadataUpdated(string metadataJsonString, address indexed operatorAddress, uint indexed operatorsCutFraction); // = owner() of this contract

    // when the operator gets slashed an amount in DATA, the corresponding amount of self-delegated operator tokens are burned (other delegators' DATA value won't change)
    //   but only down to zero, after which the DATA losses are borne by all delegators via loss of operator DATA value without corresponding operator token burn
    event OperatorSlashed(uint slashingAmountDataWei, uint slashingAmountInOperatorTokensWei, uint actuallySlashedInOperatorTokensWei);

    error AccessDeniedOperatorOnly();
    error AccessDeniedNodesOnly();
    error DelegationBelowMinimum(uint operatorTokenBalanceWei, uint minimumDelegationWei);
    error AccessDeniedDATATokenOnly();
    error SelfDelegationTooLow(uint operatorBalanceWei, uint minimumSelfDelegationWei);
    error NotMyStakedSponsorship();
    error AccessDeniedStreamrSponsorshipOnly();
    error ModuleCallError(address module, bytes data);
    error ModuleGetError(bytes data);
    error AccessDenied();
    error StakedInSponsorships();
    error NoEarnings();
    error FirstEmptyQueueThenStake();
    error ZeroUndelegation();
    error DidNotReceiveReward();
    error InvalidOperatorsCut(uint newOperatorsCutFraction);

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");

    /**
     * totalStakedIntoSponsorshipsWei is the DATA staked in all sponsorships, used for tracking the Operator contract DATA value:
     * DATA value = DATA in contract (available for staking) + DATA staked + DATA earnings in sponsorships
     */
    uint public totalStakedIntoSponsorshipsWei;
    uint public totalSlashedInSponsorshipsWei;

    IDelegationPolicy public delegationPolicy;
    IExchangeRatePolicy public exchangeRatePolicy;
    IUndelegationPolicy public undelegationPolicy;

    INodeModule public nodeModule;
    IQueueModule public queueModule;
    IStakeModule public stakeModule;

    StreamrConfig public streamrConfig;

    address public owner;

    /** DATA token address */
    IERC677 public token;

    /**
     * How much the operator gets from every withdraw (after protocol fee)
     * 1 ether == 100%, like in tokens
     **/
    uint public operatorsCutFraction;

    Sponsorship[] public sponsorships;
    mapping(Sponsorship => uint) public indexOfSponsorships; // sponsorships array index PLUS ONE! use 0 as "is it already in the array?" check

    /** stake in a Sponsorship, in DATA-wei */
    mapping(Sponsorship => uint) public stakedInto;
    /** slashed in a Sponsorship, in DATA-wei */
    mapping(Sponsorship => uint) public slashedIn;

    /** Delegators are prevented from undelegating right after delegating, so remember when they last delegated */
    mapping(address => uint) public latestDelegationTimestamp;

    struct UndelegationQueueEntry {
        address delegator;
        uint amountWei;
        uint timestamp;
    }
    mapping(uint => UndelegationQueueEntry) public queueEntryAt;
    uint public queueLastIndex;
    uint public queueCurrentIndex;

    address[] public nodes;
    mapping(address => uint) public nodeIndex; // index in nodes array PLUS ONE

    /** Every operator has a node coordination stream, and smart contract is a good place to store an authoritative reference to it */
    string public streamId;
    IStreamRegistryV4 public streamRegistry;
    string public metadata;

    modifier onlyOperator() {
        if (!hasRole(CONTROLLER_ROLE, _msgSender())) {
            revert AccessDeniedOperatorOnly();
        }
        _;
    }

    modifier onlyNodes() {
        if (nodeIndex[_msgSender()] == 0) {
            revert AccessDeniedNodesOnly();
        }
        _;
    }

    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    /**
     * Initializes the Operator smart contract into a valid state.
     * Also creates a fleet coordination stream upon creation, id = <operatorContractAddress>/operator/coordination
     * @param tokenAddress default from OperatorFactory: DATA
     * @param config default from OperatorFactory: global StreamrConfig
     * @param ownerAddress controller/owner of this Operator contract
     * @param operatorTokenName name of the Operator's internal token (e.g. "Operator 1")
     * @param operatorMetadataJson metadata for the operator (e.g. "https://streamr.network/operators/1")
     * @param operatorsCut fraction of the earnings that the operator gets from withdrawn earnings, as a fraction of 10^18 (use parseEther)
     */
    function initialize(
        address tokenAddress,
        StreamrConfig config,
        address ownerAddress,
        string memory operatorTokenName,
        string memory operatorMetadataJson,
        uint operatorsCut,
        address[3] memory modules
    ) public initializer {
        streamrConfig = config;
        __AccessControl_init();
        _setupRole(OWNER_ROLE, ownerAddress);
        _setupRole(CONTROLLER_ROLE, ownerAddress);
        _setRoleAdmin(CONTROLLER_ROLE, OWNER_ROLE); // owner sets the controllers

        token = IERC677(tokenAddress);

        nodeModule = INodeModule(modules[0]);
        queueModule = IQueueModule(modules[1]);
        stakeModule = IStakeModule(modules[2]);

        owner = ownerAddress;

        ERC20Upgradeable.__ERC20_init(operatorTokenName, operatorTokenName);

        // DEFAULT_ADMIN_ROLE is needed (by factory) for setting modules and policies
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // can't call updateMetadata because it has the onlyOperator guard
        metadata = operatorMetadataJson;
        _updateOperatorsCutFraction(operatorsCut); // emits MetadataUpdated

        moduleCall(address(nodeModule), abi.encodeWithSelector(nodeModule.createCoordinationStream.selector));
    }

    /**
     * Get an "on-chain estimate" for the DATA value of this Operator contract. This is used for the exchange rate calculation.
     * Operator value = DATA in contract (available for staking) + DATA staked + DATA earnings in sponsorships
     * The complete value can be queried and calculated in different ways:
     * 1. accurate, available off-chain: getSponsorshipsAndEarnings() returns all sponsorships and their outstanding earnings
     * 2. approximate, always available: valueWithoutEarnings() that only returns the DATA balance + DATA staked
     * @return uint Operator value - earnings = DATA balance + DATA staked
     **/
    function valueWithoutEarnings() public view returns (uint) {
        return token.balanceOf(address(this)) + totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei;
    }

    function updateMetadata(string calldata metadataJsonString) external onlyOperator {
        metadata = metadataJsonString;
        emit MetadataUpdated(metadataJsonString, owner, operatorsCutFraction);
    }

    /** Node coordination stream management added here for convenience: everything the Operator needs to do can be done via this contract. */
    function getStreamMetadata() external view returns (string memory) {
        return streamRegistry.getStreamMetadata(streamId);
    }

    /** Node coordination stream management added here for convenience: everything the Operator needs to do can be done via this contract. */
    function updateStreamMetadata(string calldata metadataJsonString) external onlyOperator {
        streamRegistry.updateStreamMetadata(streamId, metadataJsonString);
    }

    /**
     * Update operator's cut fraction.
     * Operator can update it's cut if it isn't staked into any Sponsorships, so this change will only affect future earnings.
     */
    function updateOperatorsCutFraction(uint newOperatorsCutFraction) public onlyOperator {
        _updateOperatorsCutFraction(newOperatorsCutFraction);
    }

    function _updateOperatorsCutFraction(uint newOperatorsCutFraction) internal {
        if (totalStakedIntoSponsorshipsWei > 0) { revert StakedInSponsorships(); }
        if (newOperatorsCutFraction > 1 ether) { revert InvalidOperatorsCut(newOperatorsCutFraction); }

        operatorsCutFraction = newOperatorsCutFraction;
        emit MetadataUpdated(metadata, owner, newOperatorsCutFraction);
    }

    /////////////////////////////////////////
    // DELEGATOR FUNCTIONS
    /////////////////////////////////////////

    /**
     * ERC677 token callback
     * If the data bytes contains an address, the incoming tokens are delegated on behalf of that delegator
     * If not, the token sender is the delegator
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        if (msg.sender != address(token)) { revert AccessDeniedDATATokenOnly(); }

        // check if sender is a sponsorship contract: unstaking/withdrawing from sponsorships will call this method
        // ignore returned tokens, handle them in unstake()/withdraw() instead
        Sponsorship sponsorship = Sponsorship(sender);
        if (indexOfSponsorships[sponsorship] > 0) {
            return;
        }

        // default: transferAndCall sender wants to delegate the sent DATA tokens, unless they give another address in the ERC677 satellite data
        address delegator = sender;
        if (data.length == 20) {
            // shift the 20 address bytes (= 160 bits) to end of uint256 to populate an address variable => shift by 256 - 160 = 96
            // (this is what abi.encodePacked would produce)
            assembly { delegator := shr(96, calldataload(data.offset)) } // solhint-disable-line no-inline-assembly
        } else if (data.length == 32) {
            // assume the address was encoded by converting address -> uint256 -> bytes32 -> bytes
            // (already in the least significant bytes, no shifting needed; this is what abi.encode would produce)
            assembly { delegator := calldataload(data.offset) } // solhint-disable-line no-inline-assembly
        }

        _delegate(delegator, amount);
        payOutQueue(0);
    }

    /** 2-step delegation: first call DATA.approve(operatorContract.address, amountWei) then this function */
    function delegate(uint amountWei) external {
        token.transferFrom(_msgSender(), address(this), amountWei);
        _delegate(_msgSender(), amountWei);
        payOutQueue(0);
    }

    /**
     * Final step of delegation: mint new Operator tokens and do minimum-delegation and self-delegation checks
     * NOTE: This function must be called *AFTER* the DATA tokens have already been transferred
     * @param delegator who receives the new operator tokens
     * @param amountDataWei how many DATA tokens were transferred
     **/
    function _delegate(address delegator, uint amountDataWei) internal {
        uint amountOperatorToken = moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.dataToOperatorToken.selector, amountDataWei, amountDataWei));
        _mint(delegator, amountOperatorToken);

        // owner must always be able to accept delegation without reverting (as rewards for flagging, reviewing or fishing), so skip checks
        if (delegator != owner) {
            // enforce minimum delegation amount
            uint minimumDelegationWei = streamrConfig.minimumDelegationWei();
            if (balanceOf(delegator) < minimumDelegationWei) {
                revert DelegationBelowMinimum(balanceOf(delegator), minimumDelegationWei);
            }

            // check if the delegation policy allows this delegation
            if (address(delegationPolicy) != address(0)) {
                moduleCall(address(delegationPolicy), abi.encodeWithSelector(delegationPolicy.onDelegate.selector, delegator));
            }
        }

        latestDelegationTimestamp[delegator] = block.timestamp; // solhint-disable-line not-rely-on-time
        emit Delegated(delegator, amountDataWei);
        emit BalanceUpdate(delegator, balanceOf(delegator), totalSupply(), valueWithoutEarnings());
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    /**
     * Add the request to undelegate into the undelegation queue. When new earnings arrive, they will be used to pay out the queue in order.
     * Can call `undelegate` with any `amountDataWei` but the actual amount will be capped to the actual DATA value of delegation at the time of queue payout.
     * NOTE: "Undelegate all" request can be made by calling this function e.g. like so: `operator.undelegate(maxUint256)`,
     *       where `maxUint256 = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF` (or `2**256 - 1`).
     * @param amountDataWei of requested undelegation. Can be more than the DATA value of delegation; then all of delegation is sent out (all operator tokens burned).
     **/
    function undelegate(uint amountDataWei) public {
        moduleCall(address(queueModule), abi.encodeWithSelector(queueModule._undelegate.selector, amountDataWei, _msgSender()));
    }

    /**
     * Return the value of delegations, if they were to undelegate right now
     * The actual returns for "undelegate all" transaction can in fact be more, if new earnings arrive while queuing.
     **/
    function balanceInData(address delegator) public view returns (uint amountDataWei) {
        if (balanceOf(delegator) == 0) { return 0; }
        return moduleGet(abi.encodeWithSelector(exchangeRatePolicy.operatorTokenToData.selector, balanceOf(delegator), address(exchangeRatePolicy)));
    }

    /**
     * Operator tokens transfer restrictions: operator tokens represent delegations, and so can't be completely freely transferred,
     *   since there are restrictions to joining and leaving the delegator group.
     * Transferring tokens between delegators does however make it possible to skip the undelegation queue, if you can find a buyer for your operator tokens.
     * @param from delegator that sends the operator tokens
     * @param to recipient who either should be already a delegator, or else normal delegation checks are applied (operator has enough self-delegation)
     * @param amount operator tokens to transfer (in "wei", i.e. 1 token = 1e18 wei)
    */
    function _transfer(address from, address to, uint amount) internal override {
        bool newDelegatorCreated = balanceOf(to) == 0;
        super._transfer(from, to, amount);

        // enforce minimum delegation amount, but allow transfering everything (i.e. fully undelegate)
        uint minimumDelegationWei = streamrConfig.minimumDelegationWei();
        if (balanceOf(from) < minimumDelegationWei && balanceOf(from) > 0) {
            revert DelegationBelowMinimum(balanceOf(from), minimumDelegationWei);
        }
        if (balanceOf(to) < minimumDelegationWei) {
            revert DelegationBelowMinimum(balanceOf(to), minimumDelegationWei);
        }

        // transfer creates a new delegator: check if the delegation policy allows this "delegation"
        if (newDelegatorCreated) {
            if (address(delegationPolicy) != address(0)) {
                moduleCall(address(delegationPolicy), abi.encodeWithSelector(delegationPolicy.onDelegate.selector, to));
            }
        }

        // check if the undelegation policy allows this transfer
        // zero reflects that the "undelegation" (transfer) already happened above.
        // We can't do a correct check beforehand by passing in the amount because it would have to happen in the middle
        //   of the transfer "after undelegation but before delegation", so we would actually have to burn then mint. But this works just as well.
        if (address(undelegationPolicy) != address(0)) {
            moduleCall(address(undelegationPolicy), abi.encodeWithSelector(undelegationPolicy.onUndelegate.selector, from, 0));
        }

        emit BalanceUpdate(from, balanceOf(from), totalSupply(), valueWithoutEarnings());
        emit BalanceUpdate(to, balanceOf(to), totalSupply(), valueWithoutEarnings());
    }

    /////////////////////////////////////////
    // OPERATOR FUNCTIONS: STAKE MANAGEMENT
    // Implementations found in StakeModule.sol
    /////////////////////////////////////////

    /**
     * Stake DATA tokens from this contract's DATA balance into Sponsorships.
     * Can only happen if all the delegators who want to undelegate have been paid out first.
     * This means the operator must clear the queue as part of normal operation before they can change staking allocations.
     **/
    function stake(Sponsorship sponsorship, uint amountWei) external onlyOperator {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._stake.selector, sponsorship, amountWei));
    }

    /**
     * Take out some of the stake from a sponsorship without completely unstaking
     * Except if you call this with targetStakeWei == 0, then it will actually call unstake
     **/
    function reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) external onlyOperator {
        reduceStakeWithoutQueue(sponsorship, targetStakeWei);
        payOutQueue(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function reduceStakeWithoutQueue(Sponsorship sponsorship, uint targetStakeWei) public onlyOperator {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._reduceStakeTo.selector, sponsorship, targetStakeWei));
    }

    /**
     * Unstake from a sponsorship
     * Throws if some of the stake is locked to pay for flags (being flagged or flagging others)
     **/
    function unstake(Sponsorship sponsorship) public onlyOperator {
        unstakeWithoutQueue(sponsorship);
        payOutQueue(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function unstakeWithoutQueue(Sponsorship sponsorship) public onlyOperator {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._unstake.selector, sponsorship));
    }

    /**
     * Self-service undelegation queue handling.
     * If the operator hasn't been doing its job, and the undelegation queue hasn't been paid out,
     *   anyone can come along and forceUnstake from a sponsorship to get the payouts rolling
     * Operator can also call this, if they want to forfeit the stake locked to flagging in a sponsorship (normal unstake would revert for safety)
     * @param sponsorship the funds (unstake) to pay out the queue
     * @param maxQueuePayoutIterations how many queue items to pay out, check queue status from undelegationQueue()
     */
    function forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external {
        // onlyOperator check happens only if grace period hasn't passed yet, after that anyone can call this
        if (queueIsEmpty() || block.timestamp < queueEntryAt[queueCurrentIndex].timestamp + streamrConfig.maxQueueSeconds()) { // solhint-disable-line not-rely-on-time
            if (!hasRole(CONTROLLER_ROLE, _msgSender())) {
                revert AccessDeniedOperatorOnly();
            }
        }
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._forceUnstake.selector, sponsorship));
        payOutQueue(maxQueuePayoutIterations);
    }

    //////////////////////////////////////////////////////////////////////////////////
    // OPERATOR/NODE FUNCTIONS: WITHDRAWING AND PROFIT SHARING
    // Withdrawing functions are not guarded because they "cannot harm" the Operator or delegators.
    // In fact, they should ideally be called as often as is feasible, to maintain the Operator value approximation `valueWithoutEarnings()`.
    // The only incentivized function is `withdrawEarningsFromSponsorships`, others are expected to be used by the operator or nodes only.
    //////////////////////////////////////////////////////////////////////////////////

    /**
     * If the sum of accumulated earnings over all staked Sponsorships (includes operator's share of the earnings) becomes too large,
     *   then anyone can call this method and point out a set of sponsorships where earnings together sum up to maxAllowedEarningsFraction.
     * Caller gets fishermanRewardFraction of the withdrawn earnings as a reward, if they provide that set of sponsorships.
     */
    function withdrawEarningsFromSponsorships(Sponsorship[] memory sponsorshipAddresses) external {
        uint valueBeforeWithdraw = valueWithoutEarnings();
        uint withdrawnEarningsDataWei = withdrawEarningsFromSponsorshipsWithoutQueue(sponsorshipAddresses);

        // if the caller is an outsider, and if sum of earnings are more than allowed, then send out the reward and slash operator
        address msgSender = _msgSender();
        if (!hasRole(CONTROLLER_ROLE, msgSender) && nodeIndex[msgSender] == 0) {
            uint allowedDifference = valueBeforeWithdraw * streamrConfig.maxAllowedEarningsFraction() / 1 ether;
            if (withdrawnEarningsDataWei > allowedDifference) {
                uint rewardDataWei = withdrawnEarningsDataWei * streamrConfig.fishermanRewardFraction() / 1 ether;
                _slashSelfDelegation(rewardDataWei);
                token.transfer(msgSender, rewardDataWei);
                emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
            }
        }

        payOutQueue(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function withdrawEarningsFromSponsorshipsWithoutQueue(Sponsorship[] memory sponsorshipAddresses) public returns (uint withdrawnEarningsDataWei) {
        return moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._withdrawEarnings.selector, sponsorshipAddresses));
    }

    /** Operator is slashed by burning their operator tokens */
    function _slashSelfDelegation(uint amountDataWei) internal {
        uint selfDelegation = balanceOf(owner);
        if (selfDelegation == 0) { return; }
        uint amountOperatorTokens = moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.operatorTokenToDataInverse.selector, amountDataWei));
        uint burnAmountWei = min(selfDelegation, amountOperatorTokens);
        _burn(owner, burnAmountWei);
        emit OperatorSlashed(amountDataWei, amountOperatorTokens, burnAmountWei);
        emit BalanceUpdate(owner, balanceOf(owner), totalSupply(), valueWithoutEarnings());
    }

    /**
     * Fisherman function: if there are too many earnings in another Operator, call them out and receive a reward
     * The reward will be re-delegated for the owner (same way as withdrawn earnings)
     * This function can only be called if there really are too many earnings in the other Operator to trigger the reward.
     **/
    function triggerAnotherOperatorWithdraw(Operator other, Sponsorship[] memory sponsorshipAddresses) public {
        // this was put into queue module because that module was still small enough, and it could've been put into any module (no dependent functions)
        moduleCall(address(queueModule), abi.encodeWithSelector(queueModule._triggerAnotherOperatorWithdraw.selector, other, sponsorshipAddresses));
    }

    /**
     * Convenience method to get all sponsorships and their outstanding earnings
     * The operator needs to keep an eye on the accumulated earnings at all times, so that `valueWithoutEarnings` won't be too far off from the true Operator value.
     * If someone else notices that there's too much earnings, they can call withdrawEarningsFromSponsorships to get a small reward
     * @dev Don't call from other smart contracts in a transaction, could be expensive!
     **/
    function getSponsorshipsAndEarnings() external view returns (
        address[] memory addresses,
        uint[] memory earnings,
        uint maxAllowedEarnings
    ) {
        addresses = new address[](sponsorships.length);
        earnings = new uint[](sponsorships.length);
        for (uint i; i < sponsorships.length; i++) {
            Sponsorship sponsorship = sponsorships[i];
            addresses[i] = address(sponsorship);
            earnings[i] = sponsorship.getEarnings(address(this));
        }
        maxAllowedEarnings = valueWithoutEarnings() * streamrConfig.maxAllowedEarningsFraction() / 1 ether;
    }

    //////////////////////////////////////////////////////
    // NODE FUNCTIONS: HEARTBEAT, FLAGGING, AND VOTING
    //////////////////////////////////////////////////////

    /**
     * Start the flagging process to kick out an another operator in a sponsorship we're staked in.
     * @param sponsorship one of the Sponsorships we're staked in
     * @param targetOperator the operator to flag, also staked in that Sponsorship
     * @param flagMetadata partition number and/or other conditions relevant to the failed inspection
     */
    function flag(Sponsorship sponsorship, address targetOperator, string memory flagMetadata) external onlyNodes {
        sponsorship.flag(targetOperator, flagMetadata);
    }

    /**
     * After receiving a ReviewRequest, the nodes should inspect the target and then vote if they agree with the flag.
     * @param sponsorship the Sponsorship where the flag was raised
     * @param targetOperator the operator that was flagged and who we reviewed
     * @param voteData vote for kick or no-kick, in the format expected by the Sponsorship's IKickPolicy
     **/
    function voteOnFlag(Sponsorship sponsorship, address targetOperator, bytes32 voteData) external onlyNodes {
        sponsorship.voteOnFlag(targetOperator, voteData);
    }

    /**
     * Nodes announce regularly that they're alive and how to connect to them.
     * This will be indexed in TheGraph for easy discovery.
     * @param jsonData string that encodes node ID and other connectivity metadata
     **/
    function heartbeat(string calldata jsonData) external onlyNodes {
        emit Heartbeat(_msgSender(), jsonData);
    }

    ////////////////////////////////////////
    // OPERATOR FUNCTIONS: NODE MANAGEMENT
    // Implementations found in NodeModule.sol
    ////////////////////////////////////////

    /**
     * Replace the existing node-set
     * @param newNodes new set of nodes that replaces the existing one
     **/
    function setNodeAddresses(address[] calldata newNodes) external onlyOperator {
        moduleCall(address(nodeModule), abi.encodeWithSelector(nodeModule._setNodeAddresses.selector, newNodes));
    }

    /**
     * Update the node-set by a "diff" or set-differences between new and old
     * First add then remove addresses (if in both lists, ends up removed!)
     * @param addNodes nodes that will be in the resulting set, unless they also are in `removeNodes`
     * @param removeNodes nodes that will NOT be found in the resulting set
     **/
    function updateNodeAddresses(address[] calldata addNodes, address[] calldata removeNodes) external onlyOperator {
        moduleCall(address(nodeModule), abi.encodeWithSelector(nodeModule._updateNodeAddresses.selector, addNodes, removeNodes));
    }

    /** List of nodes in the node-set */
    function getNodeAddresses() external view returns (address[] memory) {
        return nodes;
    }

    ////////////////////////////////////////
    // UNDELEGATION QUEUE
    // Implementations found in QueueModule.sol
    ////////////////////////////////////////

    function queueIsEmpty() public view returns (bool) {
        return queueCurrentIndex == queueLastIndex;
    }

    /** Get all undelegation queue entries */
    function undelegationQueue() external view returns (UndelegationQueueEntry[] memory queue) {
        uint queueLength = queueLastIndex - queueCurrentIndex;
        queue = new UndelegationQueueEntry[](queueLength);
        for (uint i; i < queueLength; i++) {
            queue[i] = queueEntryAt[queueCurrentIndex + i];
        }
    }

    /** Pay out up to maxIterations items in the queue, or until this contract's DATA balance runs out */
    function payOutQueue(uint maxIterations) public {
        moduleCall(address(queueModule), abi.encodeWithSelector(queueModule._payOutQueue.selector, maxIterations));
    }

    /**
     * Pay out the first item in the undelegation queue.
     * If this contract's DATA balance runs out, only pay the first item partially and leave it in front of the queue.
     * @return payoutComplete true if the queue is empty afterwards or funds have run out
     */
    function payOutFirstInQueue() public returns (bool payoutComplete) {
        return moduleCall(address(queueModule), abi.encodeWithSelector(queueModule._payOutFirstInQueue.selector)) != 0;
    }

    /////////////////////////////////////////
    // SPONSORSHIP CALLBACKS
    /////////////////////////////////////////

    function onSlash(uint amountSlashed) external {
        Sponsorship sponsorship = Sponsorship(msg.sender);
        if (indexOfSponsorships[sponsorship] == 0) {
            revert NotMyStakedSponsorship();
        }

        _slashSelfDelegation(amountSlashed);

        // operator value is decreased by the slashed amount => exchange rate doesn't change (unless the operator ran out of tokens)
        slashedIn[sponsorship] += amountSlashed;
        totalSlashedInSponsorshipsWei += amountSlashed;

        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    function onKick(uint, uint receivedPayoutWei) external {
        Sponsorship sponsorship = Sponsorship(msg.sender);
        if (indexOfSponsorships[sponsorship] == 0) {
            revert NotMyStakedSponsorship();
        }
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._removeSponsorship.selector, sponsorship, receivedPayoutWei));
    }

    function onReviewRequest(address targetOperator) external {
        if (SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(msg.sender) == 0) {
            revert AccessDeniedStreamrSponsorshipOnly();
        }
        Sponsorship sponsorship = Sponsorship(msg.sender);
        uint voteStartTimestamp = block.timestamp + streamrConfig.reviewPeriodSeconds(); // solhint-disable-line not-rely-on-time
        uint voteEndTimestamp = voteStartTimestamp + streamrConfig.votingPeriodSeconds();
        emit ReviewRequest(sponsorship, targetOperator, voteStartTimestamp, voteEndTimestamp, sponsorship.flagMetadataJson(targetOperator));
    }

    ////////////////////////////////////////
    // POLICY MODULES
    ////////////////////////////////////////

    function setDelegationPolicy(IDelegationPolicy policy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        delegationPolicy = policy;
        moduleCall(address(delegationPolicy), abi.encodeWithSelector(delegationPolicy.setParam.selector, param));
    }

    function setExchangeRatePolicy(IExchangeRatePolicy policy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        exchangeRatePolicy = policy;
        moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.setParam.selector, param));
    }

    function setUndelegationPolicy(IUndelegationPolicy policy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        undelegationPolicy = policy;
        moduleCall(address(undelegationPolicy), abi.encodeWithSelector(undelegationPolicy.setParam.selector, param));
    }

    /* solhint-disable */

    /**
     * Workaround to delegatecall view functions in modules
     * Suggested by https://ethereum.stackexchange.com/questions/82342/how-to-perform-delegate-call-inside-of-view-call-staticall
     * Pass the target module address in an "extra argument" to the getter function
     * @dev note the success value isn't parsed here; that would be double parsing here and then in the actual getter (below)
     * @dev instead, success is determined by the length of returndata: too long means it was a revert
     * @dev hopefully this whole kludge can be replaced with pure solidity once they get their delegate-static-call working
     */
    fallback(bytes calldata args) external returns (bytes memory) {
        if (msg.sender != address(this)) {
            revert AccessDenied();
        }

        // extra argument is 32 bytes per abi encoding; low 20 bytes are the module address
        uint len = args.length; // 4 byte selector + 32 bytes per argument
        address target = address(bytes20(args[len - 20 : len])); // grab the address
        bytes memory data = args[0 : len - 32]; // drop extra argument

        (bool success, bytes memory returndata) = target.delegatecall(data);
        if (!success) { assembly { revert(add(32, returndata), mload(returndata)) } } // re-revert the returndata as-is
        return returndata;
    }

    /**
     * Delegate-call ("library call") a module's method: it will use this Sponsorship's storage
     * When calling from a view function (staticcall context), use moduleGet instead
     */
    function moduleCall(address moduleAddress, bytes memory callBytes) internal returns (uint returnValue) {
        (bool success, bytes memory returndata) = moduleAddress.delegatecall(callBytes);
        if (!success) {
            if (returndata.length == 0) { revert ModuleCallError(moduleAddress, callBytes); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
        // assume a successful call returns precisely one uint256 or nothing, so take that out and drop the rest
        // for the function that return nothing, the returnValue will just be garbage
        assembly { returnValue := mload(add(returndata, 32)) }
    }

    /** Call a module's view function via staticcall to local fallback */
    function moduleGet(bytes memory callBytes) internal view returns (uint returnValue) {
        // trampoline through the above callback
        (bool success, bytes memory returndata) = address(this).staticcall(callBytes);
        if (!success) {
            if (returndata.length == 0) { revert ModuleGetError(callBytes); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
        // assume a successful call returns precisely one uint256, so take that out and drop the rest
        assembly { returnValue := mload(add(returndata, 32)) }
    }

    /* solhint-enable */

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function isTrustedForwarder(address forwarder) public view override(ERC2771ContextUpgradeable) returns (bool) {
        return streamrConfig.trustedForwarder() == forwarder;
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }
}
