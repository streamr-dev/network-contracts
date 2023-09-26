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
import "./IOperatorLivenessRegistry.sol";
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

// import "hardhat/console.sol";

/**
 * Operator contract receives and holds the delegators' tokens.
 * The operator (`owner()`) stakes them to Sponsorships of the streams that the operator's nodes relay.
 * Operator contract also is an ERC20 token that each delegator receives, and can swap back to DATA when they undelegate.
 *
 * @dev DATA token balance of the contract === the "free funds" available for staking,
 * @dev   so there's no need to track "unstaked tokens" separately from delegations (like Sponsorships must track stakes separately from "unallocated tokens")
 */
contract Operator is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable, ERC20Upgradeable, IOperator {

    // delegator events (initiated by anyone)
    event Delegated(address indexed delegator, uint amountDataWei);
    event Undelegated(address indexed delegator, uint amountDataWei);
    event BalanceUpdate(address delegator, uint balanceWei, uint totalSupplyWei); // Operator token tracking event
    event QueuedDataPayout(address delegator, uint amountWei, uint queueIndex);
    event QueueUpdated(address delegator, uint amountWei, uint queueIndex);

    // sponsorship events (initiated by CONTROLLER_ROLE)
    event Staked(Sponsorship indexed sponsorship);
    event Unstaked(Sponsorship indexed sponsorship);
    event StakeUpdate(Sponsorship indexed sponsorship, uint stakedWei);
    event OperatorValueUpdate(uint totalStakeInSponsorshipsWei, uint dataTokenBalanceWei); // DATA token tracking event (staked - slashed)
    event Profit(uint valueIncreaseWei, uint operatorsCutDataWei, uint protocolFeeDataWei);
    event Loss(uint valueDecreaseWei);

    // node events (initiated by nodes)
    event Heartbeat(address indexed nodeAddress, string jsonData);
    event ReviewRequest(Sponsorship indexed sponsorship, address indexed targetOperator, string flagMetadata);

    // operator admin events
    event NodesSet(address[] nodes);
    event MetadataUpdated(string metadataJsonString, address indexed operatorAddress, uint operatorsCutFraction); // = owner() of this contract

    error AccessDeniedOperatorOnly();
    error AccessDeniedNodesOnly();
    error DelegationBelowMinimum();
    error AccessDeniedDATATokenOnly();
    error NotMyStakedSponsorship();
    error AccessDeniedStreamrSponsorshipOnly();
    error ModuleCallError();
    error AccessDenied();
    error StakedInSponsorships();
    error NoEarnings();
    error FirstEmptyQueueThenStake();
    error ZeroUndelegation();
    error DidNotReceiveReward();

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    /**
     * totalStakedIntoSponsorshipsWei is the DATA staked in all sponsorships, used for tracking the Operator contract DATA value:
     * DATA value = DATA in contract (available for staking) + DATA staked + DATA earnings in sponsorships
     */
    uint public totalStakedIntoSponsorshipsWei;
    uint public totalSlashedInSponsorshipsWei;
    uint public unpaidSlashings; // operator's cut must pay all slashings, only then operator gets their cut again

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
     * How much the operator gets from every withdraw
     * 1 ether == 100%, like in tokens
     **/
    uint public operatorsCutFraction;

    Sponsorship[] public sponsorships;
    mapping(Sponsorship => uint) public indexOfSponsorships; // sponsorships array index PLUS ONE! use 0 as "is it already in the array?" check

    /** stake in a Sponsorship, in DATA-wei */
    mapping(Sponsorship => uint) public stakedInto;
    /** slashed in a Sponsorship, in DATA-wei */
    mapping(Sponsorship => uint) public slashedIn;

    struct UndelegationQueueEntry {
        address delegator;
        uint amountWei;
        uint timestamp;
    }
    mapping(uint => UndelegationQueueEntry) public undelegationQueue;
    uint public queueLastIndex;
    uint public queueCurrentIndex;

    address[] public nodes;
    mapping(address => uint) public nodeIndex; // index in nodes array PLUS ONE

    IStreamRegistryV4 public streamRegistry;
    string public streamId;
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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    /**
     * Initializes the Operator smart contract into a valid state.
     * Also creates a fleet coordination stream upon creation, id = <operatorContractAddress>/operator/coordination
     * @param tokenAddress default from OperatorFactory: DATA
     * @param streamrConfigAddress default from OperatorFactory: global StreamrConfig
     * @param ownerAddress controller/owner of this Operator contract
     * @param operatorTokenName name of the Operator's internal token (e.g. "Operator 1")
     * @param operatorMetadataJson metadata for the operator (e.g. "https://streamr.network/operators/1")
     * @param operatorsCut fraction of the earnings that the operator gets from withdrawn earnings, as a fraction of 10^18 (use parseEther)
     */
    function initialize(
        address tokenAddress,
        address streamrConfigAddress,
        address ownerAddress,
        string memory operatorTokenName,
        string memory operatorMetadataJson,
        uint operatorsCut,
        address[3] memory modules
    ) public initializer {
        __AccessControl_init();
        _setupRole(OWNER_ROLE, ownerAddress);
        _setupRole(CONTROLLER_ROLE, ownerAddress);
        _setRoleAdmin(CONTROLLER_ROLE, OWNER_ROLE); // owner sets the controllers
        _setRoleAdmin(TRUSTED_FORWARDER_ROLE, CONTROLLER_ROLE); // controller can set the GSN trusted forwarder

        token = IERC677(tokenAddress);
        streamrConfig = StreamrConfig(streamrConfigAddress);

        nodeModule = INodeModule(modules[0]);
        queueModule = IQueueModule(modules[1]);
        stakeModule = IStakeModule(modules[2]);

        owner = ownerAddress;
        operatorsCutFraction = operatorsCut;

        ERC20Upgradeable.__ERC20_init(operatorTokenName, operatorTokenName);

        // DEFAULT_ADMIN_ROLE is needed (by factory) for setting modules
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

        // can't call updateMetadata because it has the onlyOperator guard
        metadata = operatorMetadataJson;
        emit MetadataUpdated(operatorMetadataJson, owner, operatorsCutFraction);

        moduleCall(address(nodeModule), abi.encodeWithSelector(nodeModule.createCoordinationStream.selector));
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function _transfer(address from, address to, uint amount) internal override {
        // enforce minimum delegation amount, but allow transfering everything (i.e. fully undelegate)
        uint minimumDelegationWei = streamrConfig.minimumDelegationWei();
        if (balanceOf(to) + amount < minimumDelegationWei ||
            (balanceOf(from) < amount + minimumDelegationWei && balanceOf(from) != amount)) {
            revert DelegationBelowMinimum();
        }
        super._transfer(from, to, amount);
        emit BalanceUpdate(from, balanceOf(from), totalSupply());
        emit BalanceUpdate(to, balanceOf(to), totalSupply());
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

    /**
     * Return the value of delegations, if they were to undelegate right now
     * The actual returns for "undelegate all" transaction can in fact be more, if new earnings arrive while queuing.
     **/
    function balanceInData(address delegator) public view returns (uint amountDataWei) {
        if (balanceOf(delegator) == 0) { return 0; }
        return moduleGet(abi.encodeWithSelector(exchangeRatePolicy.operatorTokenToData.selector, balanceOf(delegator), address(exchangeRatePolicy)));
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }

    function updateMetadata(string calldata metadataJsonString) external onlyOperator {
        metadata = metadataJsonString;
        emit MetadataUpdated(metadataJsonString, owner, operatorsCutFraction);
    }

    function updateStreamMetadata(string calldata metadataJsonString) external onlyOperator {
        streamRegistry.updateStreamMetadata(streamId, metadataJsonString);
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
        if (_msgSender() != address(token)) {
            revert AccessDeniedDATATokenOnly();
        }

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
    }

    /** 2-step delegation: first call DATA.approve(operatorContract.address, amountWei) then this function */
    function delegate(uint amountWei) public payable {
        token.transferFrom(_msgSender(), address(this), amountWei);
        _delegate(_msgSender(), amountWei);
    }

    /**
     * Final step of delegation: mint new Operator tokens
     * NOTE: This function must be called *AFTER* the DATA tokens have already been transferred
     * @param delegator who receives the new operator tokens
     * @param amountDataWei how many DATA tokens were transferred
     **/
    function _delegate(address delegator, uint amountDataWei) internal {
        uint amountOperatorToken = moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.dataToOperatorToken.selector, amountDataWei, amountDataWei));
        _mint(delegator, amountOperatorToken);

        // check if the delegation policy allows this delegation
        if (address(delegationPolicy) != address(0)) {
            moduleCall(address(delegationPolicy), abi.encodeWithSelector(delegationPolicy.onDelegate.selector, delegator));
        }

        emit Delegated(delegator, amountDataWei);
        emit BalanceUpdate(delegator, balanceOf(delegator), totalSupply());
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    /**
     * Add the request to undelegate into the undelegation queue. When new earnings arrive, they will be used to pay out the queue in order.
     * It's all call `undelegate` with any `amountWei`, the actual amount is decided when it's your turn, and will be capped to the actual balance at the time.
     * NOTE: "Undelegate all" request can be made by calling this function e.g. like so: `operator.undelegate(maxUint256)`,
     *       where `maxUint256 = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF` (or `2**256 - 1`).
     * @param amountWei of operator tokens to convert back to DATA. Can be more than the balance; then all operator tokens are undelegated.
     **/
    function undelegate(uint amountWei) public {
        moduleCall(address(queueModule), abi.encodeWithSelector(queueModule._undelegate.selector, amountWei));
    }

    /////////////////////////////////////////
    // OPERATOR FUNCTIONS: STAKE MANAGEMENT
    // Implementations found in StakeModule.sol
    /////////////////////////////////////////

    function stake(Sponsorship sponsorship, uint amountWei) external onlyOperator virtual {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._stake.selector, sponsorship, amountWei));
    }
    function reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) external onlyOperator virtual {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._reduceStakeTo.selector, sponsorship, targetStakeWei));
    }
    function reduceStakeWithoutQueue(Sponsorship sponsorship, uint targetStakeWei) public onlyOperator virtual {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._reduceStakeWithoutQueue.selector, sponsorship, targetStakeWei));
    }
    function unstake(Sponsorship sponsorship) public onlyOperator virtual {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._unstake.selector, sponsorship));
    }
    function unstakeWithoutQueue(Sponsorship sponsorship) public onlyOperator virtual {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._unstakeWithoutQueue.selector, sponsorship));
    }
    function forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external virtual {
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._forceUnstake.selector, sponsorship, maxQueuePayoutIterations));
    }

    //////////////////////////////////////////////////////////////////////////////////
    // OPERATOR/NODE FUNCTIONS: WITHDRAWING AND PROFIT SHARING
    // Withdrawing functions are not guarded because they "cannot harm" the Operator or delegators.
    // In fact, they should ideally be called as often as is feasible, to maintain the Operator value approximation `valueWithoutEarnings()`.
    // The only incentivized function is `withdrawEarningsFromSponsorships`, others are expected to be used by the operator or nodes only.
    //////////////////////////////////////////////////////////////////////////////////

    /**
     * Update operator's cut fraction.
     * Operator can update it's cut if it isn't staked into any Sponsorships
     */
    function updateOperatorsCutFraction(uint newOperatorsCutFraction) external onlyOperator {
        if (totalStakedIntoSponsorshipsWei > 0) {
            revert StakedInSponsorships();
        }

        operatorsCutFraction = newOperatorsCutFraction;
        emit MetadataUpdated(metadata, _msgSender(), newOperatorsCutFraction);
    }

    function withdrawEarningsFromSponsorships(Sponsorship[] memory sponsorshipAddresses) public virtual {
        // this is in stakeModule because it calls _handleProfit
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._withdrawEarningsFromSponsorships.selector, sponsorshipAddresses));
    }
    function withdrawEarningsFromSponsorshipsWithoutQueue(Sponsorship[] memory sponsorshipAddresses) public virtual {
        // this is in stakeModule because it calls _handleProfit
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._withdrawEarningsFromSponsorshipsWithoutQueue.selector, sponsorshipAddresses));
    }

    /**
     * Fisherman function: if there are too many earnings in another Operator, call them out and receive a reward
     * The reward will be re-delegated for the owner (same way as withdrawn earnings)
     * This function can only be called if there really are too many earnings in the other Operator.
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
        for (uint i = 0; i < sponsorships.length; i++) {
            Sponsorship sponsorship = sponsorships[i];
            addresses[i] = address(sponsorship);
            earnings[i] = sponsorship.getEarnings(address(this));
        }
        maxAllowedEarnings = valueWithoutEarnings() * streamrConfig.maxAllowedEarningsFraction() / 1 ether;
    }


    ////////////////////////////////////////
    // NODE FUNCTIONS: HEARTBEAT, FLAGGING, AND VOTING
    ////////////////////////////////////////

    function flag(Sponsorship sponsorship, address targetOperator, string memory flagMetadata) external onlyNodes {
        sponsorship.flag(targetOperator, flagMetadata);
    }

    function voteOnFlag(Sponsorship sponsorship, address targetOperator, bytes32 voteData) external onlyNodes {
        sponsorship.voteOnFlag(targetOperator, voteData);
    }

    /** Nodes announce their ID and other connectivity metadata */
    function heartbeat(string calldata jsonData) external onlyNodes {
        emit Heartbeat(_msgSender(), jsonData);
    }

    ////////////////////////////////////////
    // OPERATOR FUNCTIONS: NODE MANAGEMENT
    // Implementations found in NodeModule.sol
    ////////////////////////////////////////

    mapping (address => bool) private isInNewNodes; // lookup used during the setNodeAddresses
    function setNodeAddresses(address[] calldata newNodes) external onlyOperator {
        moduleCall(address(nodeModule), abi.encodeWithSelector(nodeModule._setNodeAddresses.selector, newNodes));
    }

    /** First add then remove addresses (if in both lists, ends up removed!) */
    function updateNodeAddresses(address[] calldata addNodes, address[] calldata removeNodes) external onlyOperator {
        moduleCall(address(nodeModule), abi.encodeWithSelector(nodeModule._updateNodeAddresses.selector, addNodes, removeNodes));
    }

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

    /**
     * Get the position of the LAST undelegation request in the queue for the given delegator.
     * Answers the question 'how many queue positions must (still) be paid out before I get (all) my queued tokens?'
     *   for the purposes of "self-service undelegation" (forceUnstake or payOutQueue)
     * If delegator is not in the queue, returns just the length of the queue + 1 (i.e. the position they'd get if they undelegate now)
     */
    function queuePositionOf(address delegator) external view returns (uint) {
        for (uint i = queueLastIndex - 1; i >= queueCurrentIndex; i--) {
            if (undelegationQueue[i].delegator == delegator) {
                return i - queueCurrentIndex + 1;
            }
        }
        return queueLastIndex - queueCurrentIndex + 1;
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
        Sponsorship sponsorship = Sponsorship(_msgSender());
        if (indexOfSponsorships[sponsorship] == 0) {
            revert NotMyStakedSponsorship();
        }
        slashedIn[sponsorship] += amountSlashed;
        totalSlashedInSponsorshipsWei += amountSlashed;
        unpaidSlashings += amountSlashed;
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    function onKick(uint, uint receivedPayoutWei) external {
        Sponsorship sponsorship = Sponsorship(_msgSender());
        if (indexOfSponsorships[sponsorship] == 0) {
            revert NotMyStakedSponsorship();
        }
        // _removeSponsorship(sponsorship, receivedPayoutWei);
        moduleCall(address(stakeModule), abi.encodeWithSelector(stakeModule._removeSponsorship.selector, sponsorship, receivedPayoutWei));
    }

    function onReviewRequest(address targetOperator) external {
        if (SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(_msgSender()) == 0) {
            revert AccessDeniedStreamrSponsorshipOnly();
        }
        Sponsorship sponsorship = Sponsorship(_msgSender());
        emit ReviewRequest(sponsorship, targetOperator, sponsorship.flagMetadataJson(targetOperator));
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
            if (returndata.length == 0) { revert ModuleCallError(); }
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
            if (returndata.length == 0) { revert(); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
        // assume a successful call returns precisely one uint256, so take that out and drop the rest
        assembly { returnValue := mload(add(returndata, 32)) }
    }

    /* solhint-enable */
}
