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
import "./OperatorPolicies/IPoolYieldPolicy.sol";
import "./OperatorPolicies/IUndelegationPolicy.sol";

import "./StreamrConfig.sol";
import "./Sponsorship.sol";
import "./SponsorshipFactory.sol";

import "../StreamRegistry/IStreamRegistryV4.sol";

// import "hardhat/console.sol";

/**
 * Operator contract receives and holds the delegators' tokens.
 * The operator (owner()) stakes them to Sponsorships of the streams that the operator's nodes relay.
 * Operator contract also is an ERC20 token that each delegator receives, and can swap back to DATA when they undelegate.
 *
 * @dev DATA token balance of the pool === the "free funds" available for staking,
 * @dev   so there's no need to track "unstaked tokens" separately from delegations (like Sponsorships must track stakes separately from "unallocated tokens")
 */
contract Operator is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable, ERC20Upgradeable, IOperator { //}, ERC2771Context {

    // delegator events (initiated by anyone)
    event Delegated(address indexed delegator, uint amountDataWei);
    event Undelegated(address indexed delegator, uint amountDataWei);
    event BalanceUpdate(address delegator, uint totalPoolTokenWei, uint totalSupplyPoolTokenWei); // Pool token tracking event
    event QueuedDataPayout(address delegator, uint amountPoolTokenWei, uint queueIndex);
    event QueueUpdated(address delegator, uint amountPoolTokenWei, uint queueIndex);

    // sponsorship events (initiated by CONTROLLER_ROLE)
    event Staked(Sponsorship indexed sponsorship);
    event Unstaked(Sponsorship indexed sponsorship);
    event StakeUpdate(Sponsorship indexed sponsorship, uint stakedWei);
    event PoolValueUpdate(uint totalStakeInSponsorshipsWei, uint freeFundsWei); // DATA token tracking event (staked - slashed)
    event Profit(uint poolIncreaseWei, uint operatorsCutDataWei, uint protocolFeeDataWei);
    event Loss(uint poolDecreaseWei);

    // node events (initiated by nodes)
    event Heartbeat(address indexed nodeAddress, string jsonData);
    event ReviewRequest(Sponsorship indexed sponsorship, address indexed targetOperator, string flagMetadata);

    // operator admin events
    event NodesSet(address[] nodes);
    event MetadataUpdated(string metadataJsonString, address indexed operatorAddress, uint operatorsCutFraction); // = owner() of this contract

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    /**
     * totalStakedIntoSponsorshipsWei is used for tracking the pool value in DATA
     *
     * Pool value = DATA value of all stake + earnings in sponsorships - operator's share of those earnings
     * It can be queried / calculated in different ways:
     * 1. accurate but expensive: calculatePoolValueInData() (loops over sponsorships)
     * 2. approximate but always available: getApproximatePoolValue() (tracks only the stake+funds, does not include accumulated earnings)
     *      getApproximatePoolValue = totalStakedIntoSponsorshipsWei + DATA.balanceOf(this) - totalSlashedInSponsorshipsWei
     */
    uint public totalStakedIntoSponsorshipsWei;
    uint public totalSlashedInSponsorshipsWei;

    IDelegationPolicy public delegationPolicy;
    IPoolYieldPolicy public yieldPolicy;
    IUndelegationPolicy public undelegationPolicy;

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
        uint amountPoolTokenWei;
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
        require(hasRole(CONTROLLER_ROLE, _msgSender()), "error_onlyOperator");
        _;
    }

    modifier onlyNodes() {
        require(nodeIndex[_msgSender()] > 0, "error_onlyNodes");
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
     * @param poolTokenName name of the pool token (e.g. "Operator 1")
     * @param operatorMetadataJson metadata for the operator (e.g. "https://streamr.network/operators/1")
     * @param operatorsCut fraction of the earnings that the operator gets from withdrawn earnings, as a fraction of 10^18 (use parseEther)
     */
    function initialize(
        address tokenAddress,
        address streamrConfigAddress,
        address ownerAddress,
        string memory poolTokenName,
        string memory operatorMetadataJson,
        uint operatorsCut
    ) public initializer {
        __AccessControl_init();
        _setupRole(OWNER_ROLE, ownerAddress);
        _setupRole(CONTROLLER_ROLE, ownerAddress);
        _setRoleAdmin(CONTROLLER_ROLE, OWNER_ROLE); // owner sets the controllers
        _setRoleAdmin(TRUSTED_FORWARDER_ROLE, CONTROLLER_ROLE); // controller can set the GSN trusted forwarder

        token = IERC677(tokenAddress);
        streamrConfig = StreamrConfig(streamrConfigAddress);
        owner = ownerAddress;
        operatorsCutFraction = operatorsCut;

        ERC20Upgradeable.__ERC20_init(poolTokenName, poolTokenName);

        // DEFAULT_ADMIN_ROLE is needed (by factory) for setting modules
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

        // can't call updateMetadata because it has the onlyOperator guard
        metadata = operatorMetadataJson;
        emit MetadataUpdated(operatorMetadataJson, owner, operatorsCutFraction);

        streamRegistry = IStreamRegistryV4(streamrConfig.streamRegistryAddress());
        // TODO: avoid this stream.concat once streamRegistry.createStream returns the streamId (ETH-505)
        streamId = string.concat(streamRegistry.addressToString(address(this)), "/operator/coordination");
        streamRegistry.createStream("/operator/coordination", "{\"partitions\":1}");
        streamRegistry.grantPublicPermission(streamId, IStreamRegistryV4.PermissionType.Subscribe);
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function _transfer(address from, address to, uint amount) internal override {
        // enforce minimum delegation amount, but allow transfering everything (i.e. fully undelegate)
        require(balanceOf(from) >= amount + streamrConfig.minimumDelegationWei() || balanceOf(from) == amount, "error_delegationBelowMinimum");
        super._transfer(from, to, amount);
        emit BalanceUpdate(from, balanceOf(from), totalSupply());
        emit BalanceUpdate(to, balanceOf(to), totalSupply());
    }

    /** Pool value (DATA) = staked in sponsorships + free funds, does not include unwithdrawn earnings */
    function getApproximatePoolValue() public view returns (uint) {
        return totalStakedIntoSponsorshipsWei + token.balanceOf(address(this)) - totalSlashedInSponsorshipsWei;
    }

    function getMyBalanceInData() public view returns (uint amountDataWei) {
        // console.log("## getMyBalanceInData");
        uint poolTokenBalance = balanceOf(_msgSender());
        (uint dataWei) = moduleGet(abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector, poolTokenBalance, 0, address(yieldPolicy)), "error_pooltokenToData_Failed");
        // console.log("getMyBalanceInData dataWei", dataWei);
        return dataWei;
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
     * If the address is this contract, then add tokens to free funds (don't delegate at all)
     *    Those tokens are "gifted" to the Operator contract, and won't be delegated for anyone, but instead count as Profit.
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        // console.log("## onTokenTransfer from", sender);
        // console.log("onTokenTransfer amount", amount);
        require(_msgSender() == address(token), "error_onlyDATAToken");

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

        // "gifted" tokens aren't delegated at all, but instead count as Profit
        if (delegator == address(this)) {
            _handleProfit(amount, address(0));
        } else {
            _mintPoolTokensFor(delegator, amount);
            emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
        }
    }

    /** 2-step delegation: first call DATA.approve(operatorContract.address, amountWei) then this function */
    function delegate(uint amountWei) public payable {
        // console.log("## delegate");
        token.transferFrom(_msgSender(), address(this), amountWei);
        _mintPoolTokensFor(_msgSender(), amountWei);
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    /** DATA token transfer must have happened before calling this function, give back the correct amount of pool tokens */
    function _mintPoolTokensFor(address delegator, uint amountDataWei) internal {
        // remove amountDataWei from pool value to get the "Pool Tokens before transfer" for the exchange rate calculation
        uint amountPoolToken = moduleCall(address(yieldPolicy),
            abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector, amountDataWei, amountDataWei),
            "error_dataToPooltokenFailed"
        );
        _mint(delegator, amountPoolToken);

        // check if the delegation policy allows this delegation
        if (address(delegationPolicy) != address(0)) {
            moduleCall(address(delegationPolicy), abi.encodeWithSelector(delegationPolicy.onDelegate.selector, delegator), "error_delegationPolicyFailed");
        }

        emit Delegated(delegator, amountDataWei);
        emit BalanceUpdate(delegator, balanceOf(delegator), totalSupply());
    }

    /** Add the request to undelegate into the undelegation queue */
    function undelegate(uint amountPoolTokenWei) public {
        // console.log("## undelegate");
        require(amountPoolTokenWei > 0, "error_zeroUndelegation"); // TODO: should there be minimum undelegation amount?

        address undelegator = _msgSender();

        // check if the undelegation policy allows this undelegation
        // this check must happen before payOutQueueWithFreeFunds because we can't know how much gets paid out
        if (address(undelegationPolicy) != address(0)) {
            moduleCall(address(undelegationPolicy), abi.encodeWithSelector(undelegationPolicy.onUndelegate.selector, undelegator, amountPoolTokenWei), "error_undelegationPolicyFailed");
        }

        undelegationQueue[queueLastIndex] = UndelegationQueueEntry(undelegator, amountPoolTokenWei, block.timestamp); // solhint-disable-line not-rely-on-time
        emit QueuedDataPayout(undelegator, amountPoolTokenWei, queueLastIndex);
        queueLastIndex++;
        payOutQueueWithFreeFunds(0);
    }

    /////////////////////////////////////////
    // OPERATOR FUNCTIONS
    /////////////////////////////////////////

    /**
     * Update operator's cut fraction.
     * Operator can update it's cut if it isn't staked into any Sponsorships
     */
    function updateOperatorsCutFraction(uint newOperatorsCutFraction) external onlyOperator {
        require(totalStakedIntoSponsorshipsWei == 0, "error_stakedInSponsorships");

        operatorsCutFraction = newOperatorsCutFraction;
        emit MetadataUpdated(metadata, _msgSender(), newOperatorsCutFraction);
    }

    /**
     * Stake DATA tokens from free funds into Sponsorships.
     * Can only happen if all the delegators who want to undelegate have been paid out first.
     * This means the operator must clear the queue as part of normal operation before they can change staking allocations.
     **/
    function stake(Sponsorship sponsorship, uint amountWei) external onlyOperator {
        require(SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(address(sponsorship)) > 0, "error_badSponsorship");
        require(queueIsEmpty(), "error_firstEmptyQueueThenStake");
        token.approve(address(sponsorship), amountWei);
        sponsorship.stake(address(this), amountWei); // may fail if amountWei < minimumStake
        stakedInto[sponsorship] += amountWei;
        totalStakedIntoSponsorshipsWei += amountWei;
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));

        if (indexOfSponsorships[sponsorship] == 0) { // initial staking in a new sponsorship
            sponsorships.push(sponsorship);
            indexOfSponsorships[sponsorship] = sponsorships.length; // real array index + 1
            if (sponsorships.length == 1) {
                try IOperatorLivenessRegistry(streamrConfig.operatorLivenessRegistry()).registerAsLive() {} catch {}
            }
            emit Staked(sponsorship);
        }
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
    }

    /**
     * Take out some of the stake from a sponsorship without completely unstaking
     * Except if you call this with targetStakeWei == 0, then it will actually call unstake
     **/
    function reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) external onlyOperator {
        // console.log("## reduceStake amountWei", amountWei);
        reduceStakeWithoutQueue(sponsorship, targetStakeWei);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function reduceStakeWithoutQueue(Sponsorship sponsorship, uint targetStakeWei) public onlyOperator {
        if (targetStakeWei == 0) {
            unstakeWithoutQueue(sponsorship);
            return;
        }
        uint cashoutWei = sponsorship.reduceStakeTo(targetStakeWei);
        stakedInto[sponsorship] -= cashoutWei;
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
        totalStakedIntoSponsorshipsWei -= cashoutWei;
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    function withdrawEarningsFromSponsorship(Sponsorship sponsorship) external onlyOperator {
        withdrawEarningsFromSponsorshipWithoutQueue(sponsorship);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function withdrawEarningsFromSponsorshipWithoutQueue(Sponsorship sponsorship) public onlyOperator {
        // takes all earnings, including the operator's share
        uint earningsDataWei = sponsorship.withdraw();
        _handleProfit(earningsDataWei, address(0));
    }

    /**
     * If the sum of accumulated earnings over all staked Sponsorships (includes operator's share of the earnings) becomes too large,
     *   then anyone can call this method and point out a set of sponsorships where earnings together sum up to poolValueDriftLimitFraction.
     * Caller gets poolValueDriftPenaltyFraction of the operator's earnings share as a reward, if they provide that set of sponsorships.
     */
    function withdrawEarningsFromSponsorships(Sponsorship[] memory sponsorshipAddresses) public {
        uint poolValueBeforeWithdraw = getApproximatePoolValue();

        uint sumEarnings = 0;
        for (uint i = 0; i < sponsorshipAddresses.length; i++) {
            sumEarnings += sponsorshipAddresses[i].withdraw(); // this contract receives DATA tokens
        }
        require(sumEarnings > 0, "error_noEarnings");

        // if sum of earnings are more than allowed, then give poolValueDriftPenaltyFraction of the operator's cut to the caller as a reward
        address penaltyRecipient = address(0);
        if (!hasRole(CONTROLLER_ROLE, _msgSender())) {
            uint allowedDifference = poolValueBeforeWithdraw * streamrConfig.poolValueDriftLimitFraction() / 1 ether;
            if (sumEarnings > allowedDifference) {
                penaltyRecipient = _msgSender();
            }
        }
        _handleProfit(sumEarnings, penaltyRecipient);

        payOutQueueWithFreeFunds(0);
    }

    /**
     * Fisherman function: if there are too many unwithdrawn earnings in another Operator, call them out and receive a reward
     * The reward will be re-delegated for the owner (same way as withdrawn earnings)
     * This function can only be called if there really are too many unwithdrawn earnings in the other Operator.
     **/
    function triggerAnotherOperatorWithdraw(Operator other, Sponsorship[] memory sponsorshipAddresses) public onlyOperator {
        uint balanceBeforeWei = token.balanceOf(address(this));
        other.withdrawEarningsFromSponsorships(sponsorshipAddresses);
        uint balanceAfterWei = token.balanceOf(address(this));
        uint earnings = balanceAfterWei - balanceBeforeWei;
        require(earnings > 0, "error_didNotReceiveReward");
        // new DATA tokens are still unaccounted, will go to self-delegation instead of Profit
        _mintPoolTokensFor(owner, earnings);
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, balanceAfterWei);
    }

    /**
     * Unstake from a sponsorship
     * Throws if some of the stake is committed to a flag (being flagged or flagging others)
     **/
    function unstake(Sponsorship sponsorship) public onlyOperator {
        unstakeWithoutQueue(sponsorship);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function unstakeWithoutQueue(Sponsorship sponsorship) public onlyOperator {
        uint balanceBeforeWei = token.balanceOf(address(this));
        sponsorship.unstake();
        _removeSponsorship(sponsorship, token.balanceOf(address(this)) - balanceBeforeWei);
    }

    /**
     * Self-service undelegation queue handling.
     * If the operator hasn't been doing its job, and undelegationQueue hasn't been paid out,
     *   anyone can come along and forceUnstake from a sponsorship to get the payouts rolling
     * Operator can also call this, if they want to forfeit the stake committed to flagging in a sponsorship (normal unstake would revert for safety)
     * @param sponsorship the funds (unstake) to pay out the queue
     * @param maxQueuePayoutIterations how many queue items to pay out, see getMyQueuePosition()
     */
    function forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external {
        // onlyOperator check happens only if grace period hasn't passed yet
        if (block.timestamp < undelegationQueue[queueCurrentIndex].timestamp + streamrConfig.maxQueueSeconds()) { // solhint-disable-line not-rely-on-time
            require(hasRole(CONTROLLER_ROLE, _msgSender()), "error_onlyOperator");
        }

        uint balanceBeforeWei = token.balanceOf(address(this));
        sponsorship.forceUnstake();
        _removeSponsorship(sponsorship, token.balanceOf(address(this)) - balanceBeforeWei);
        payOutQueueWithFreeFunds(maxQueuePayoutIterations);
    }

    /**
     * Remove a Sponsorship from bookkeeping - either we unstaked from it or got kicked out.
     * Also calculate the Profit/Loss from that investment at this point.
     * Earnings were mixed together with stake in the unstaking process; only earnings on top of what has been staked is emitted in Profit event.
     * This means whatever was slashed gets also deducted from the operator's share
     */
    function _removeSponsorship(Sponsorship sponsorship, uint receivedDuringUnstakingWei) private {
        totalStakedIntoSponsorshipsWei -= stakedInto[sponsorship];
        totalSlashedInSponsorshipsWei -= slashedIn[sponsorship];

        if (receivedDuringUnstakingWei < stakedInto[sponsorship]) {
            uint lossWei = stakedInto[sponsorship] - receivedDuringUnstakingWei;
            emit Loss(lossWei);
        } else {
            uint profitDataWei = receivedDuringUnstakingWei - stakedInto[sponsorship];
            _handleProfit(profitDataWei, address(0));
        }

        // remove from array: replace with the last element
        uint index = indexOfSponsorships[sponsorship] - 1; // indexOfSponsorships is the real array index + 1
        Sponsorship lastSponsorship = sponsorships[sponsorships.length - 1];
        sponsorships[index] = lastSponsorship;
        sponsorships.pop();
        indexOfSponsorships[lastSponsorship] = index + 1; // indexOfSponsorships is the real array index + 1
        delete indexOfSponsorships[sponsorship];
        if (sponsorships.length == 0) {
            try IOperatorLivenessRegistry(streamrConfig.operatorLivenessRegistry()).registerAsNotLive() {} catch {}
        }

        // remove from stake/slashing tracking
        stakedInto[sponsorship] = 0;
        slashedIn[sponsorship] = 0;
        emit Unstaked(sponsorship);
        emit StakeUpdate(sponsorship, 0);
    }

    /**
     * Whenever profit (earnings from Sponsorships) comes in,
     *  pay part of it to the Operator by minting pool tokens, and also
     *  pay part of it as protocol fee
     * If the operator is penalized for too much unwithdrawn earnings, a penalty will be deducted from the operator's cut and sent to operatorPenaltyRecipient
     * @param earningsDataWei income to be processed, in DATA
     * @param operatorPenaltyRecipient non-zero if the operator is penalized for too much unwithdrawn earnings, otherwise `address(0)`
     **/
    function _handleProfit(uint earningsDataWei, address operatorPenaltyRecipient) private {
        uint protocolFee = earningsDataWei * streamrConfig.protocolFeeFraction() / 1 ether;

        uint operatorsCutDataWei = (earningsDataWei - protocolFee) * operatorsCutFraction / 1 ether;

        uint operatorPenaltyDataWei = 0;
        if (operatorPenaltyRecipient != address(0)) {
            operatorPenaltyDataWei = operatorsCutDataWei * streamrConfig.poolValueDriftPenaltyFraction() / 1 ether;
            token.transfer(operatorPenaltyRecipient, operatorPenaltyDataWei);
        }

        // "self-delegate" the operator's share === mint new pooltokens
        _mintPoolTokensFor(owner, operatorsCutDataWei - operatorPenaltyDataWei);

        // the rest is added to free funds, inflating the pool token value, and counted as Profit
        emit Profit(earningsDataWei - protocolFee - operatorsCutDataWei, operatorsCutDataWei - operatorPenaltyDataWei, protocolFee);
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    ////////////////////////////////////////
    // NODE FUNCTIONALITY
    // NODE MANAGEMENT
    ////////////////////////////////////////

    function flag(Sponsorship sponsorship, address targetOperator) external onlyNodes {
        sponsorship.flag(targetOperator);
    }

    function flagWithMetadata(Sponsorship sponsorship, address targetOperator, string memory flagMetadata) external onlyNodes {
        sponsorship.flagWithMetadata(targetOperator, flagMetadata);
    }

    function voteOnFlag(Sponsorship sponsorship, address targetOperator, bytes32 voteData) external onlyNodes {
        sponsorship.voteOnFlag(targetOperator, voteData);
    }

    /** Nodes announce their ID and other connectivity metadata */
    function heartbeat(string calldata jsonData) external onlyNodes {
        emit Heartbeat(_msgSender(), jsonData);
    }

    mapping (address => bool) private isInNewNodes; // lookup used during the setNodeAddresses
    function setNodeAddresses(address[] calldata newNodes) external onlyOperator {
        // add new nodes on top
        for (uint i = 0; i < newNodes.length; i++) {
            address node = newNodes[i];
            if (nodeIndex[node] == 0) {
                _addNode(node);
            }
            isInNewNodes[node] = true;
        }
        // remove from old nodes
        for (uint i = 0; i < nodes.length;) {
            address node = nodes[i];
            if (!isInNewNodes[node]) {
                _removeNode(node);
            } else {
                i++;
            }
        }
        // reset lookup (TODO: replace with transient storage once https://eips.ethereum.org/EIPS/eip-1153 is available)
        for (uint i = 0; i < newNodes.length; i++) {
            address node = newNodes[i];
            delete isInNewNodes[node];
        }
        emit NodesSet(nodes);
    }

    /** First add then remove addresses (if in both lists, ends up removed!) */
    function updateNodeAddresses(address[] calldata addNodes, address[] calldata removeNodes) external onlyOperator {
        for (uint i = 0; i < addNodes.length; i++) {
            address node = addNodes[i];
            if (nodeIndex[node] == 0) {
                _addNode(node);
            }
        }
        for (uint i = 0; i < removeNodes.length; i++) {
            address node = removeNodes[i];
            if (nodeIndex[node] > 0) {
                _removeNode(node);
            }
        }
        emit NodesSet(nodes);
    }

    function _addNode(address node) internal {
        nodes.push(node);
        nodeIndex[node] = nodes.length; // will be +1

        streamRegistry.grantPermission(streamId, node, IStreamRegistryV4.PermissionType.Publish);
    }

    function _removeNode(address node) internal {
        uint index = nodeIndex[node] - 1;
        address lastNode = nodes[nodes.length - 1];
        nodes[index] = lastNode;
        nodes.pop();
        nodeIndex[lastNode] = index + 1;
        delete nodeIndex[node];

        streamRegistry.revokePermission(streamId, node, IStreamRegistryV4.PermissionType.Publish);
    }

    function getNodeAddresses() external view returns (address[] memory) {
        return nodes;
    }

    ////////////////////////////////////////
    // UNDELEGATION QUEUE
    ////////////////////////////////////////

    function queueIsEmpty() public view returns (bool) {
        return queueCurrentIndex == queueLastIndex;
    }

    /**
     * Get the position of the LAST undelegation request in the queue for the given delegator.
     * Answers the question 'how many queue positions must (still) be paid out before I get (all) my queued tokens?'
     *   for the purposes of "self-service undelegation" (forceUnstake or payOutQueueWithFreeFunds)
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

    /* solhint-disable reentrancy */ // TODO: remove when solhint stops being silly

    /** Pay out up to maxIterations items in the queue */
    function payOutQueueWithFreeFunds(uint maxIterations) public {
        if (maxIterations == 0) { maxIterations = 1 ether; }
        for (uint i = 0; i < maxIterations; i++) {
            if (payOutFirstInQueue()) {
                break;
            }
        }
    }

    /**
     * Pay out the first item in the undelegation queue.
     * If free funds run out, only pay the first item partially and leave it in front of the queue.
     * @return payoutComplete true if the queue is empty afterwards or funds have run out
     */
    function payOutFirstInQueue() public returns (bool payoutComplete) {
        uint balanceDataWei = token.balanceOf(address(this));
        if (balanceDataWei == 0 || queueIsEmpty()) {
            return true;
        }

        // Take the first element from the queue, and silently cap it to the amount of pool tokens the exiting delegator has,
        //   this means it's ok to add infinity tokens to undelegation queue, it means "undelegate all my tokens".
        // Also, if the delegator would be left with less than minimumDelegationWei, just undelegate the whole balance (don't leave sand delegations)
        address delegator = undelegationQueue[queueCurrentIndex].delegator;
        uint amountPoolTokens = undelegationQueue[queueCurrentIndex].amountPoolTokenWei;
        if (balanceOf(delegator) < amountPoolTokens + streamrConfig.minimumDelegationWei()) {
            amountPoolTokens = balanceOf(delegator);
        }

        // nothing to pay => pop the queue item
        if (amountPoolTokens == 0) {
            delete undelegationQueue[queueCurrentIndex];
            emit QueueUpdated(delegator, 0, queueCurrentIndex);
            queueCurrentIndex++;
            return false;
        }

        // convert to DATA and see if we have enough free funds to pay out the queue item in full
        uint amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            amountPoolTokens, 0), "error_yieldPolicy_pooltokenToData_Failed");
        if (balanceDataWei >= amountDataWei) {
            // enough DATA for payout => whole amountDataWei is paid out => pop the queue item
            delete undelegationQueue[queueCurrentIndex];
            emit QueueUpdated(delegator, 0, queueCurrentIndex);
            queueCurrentIndex++;
        } else {
            // not enough DATA for full payout => all free funds are paid out as a partial payment, update the item in the queue
            amountDataWei = balanceDataWei;
            amountPoolTokens = moduleCall(address(yieldPolicy),
                abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
                amountDataWei, 0), "error_dataToPooltokenFailed"
            );
            UndelegationQueueEntry memory oldEntry = undelegationQueue[queueCurrentIndex];
            uint poolTokensLeftInQueue = oldEntry.amountPoolTokenWei - amountPoolTokens;
            undelegationQueue[queueCurrentIndex] = UndelegationQueueEntry(oldEntry.delegator, poolTokensLeftInQueue, oldEntry.timestamp);
            emit QueueUpdated(delegator, poolTokensLeftInQueue, queueCurrentIndex);
        }

        // console.log("payOutFirstInQueue: pool tokens", amountPoolTokens, "DATA", amountDataWei);
        _burn(delegator, amountPoolTokens);
        token.transfer(delegator, amountDataWei);
        emit Undelegated(delegator, amountDataWei);
        emit BalanceUpdate(delegator, balanceOf(delegator), totalSupply());
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));

        return token.balanceOf(address(this)) == 0 || queueIsEmpty();
    }

    /* solhint-enable reentrancy */

    /////////////////////////////////////////
    // SPONSORSHIP CALLBACKS
    /////////////////////////////////////////

    function onSlash(uint amountSlashed) external {
        Sponsorship sponsorship = Sponsorship(_msgSender());
        require(indexOfSponsorships[sponsorship] > 0, "error_notMyStakedSponsorship");
        slashedIn[sponsorship] += amountSlashed;
        totalSlashedInSponsorshipsWei += amountSlashed;
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    function onKick(uint, uint receivedPayoutWei) external {
        Sponsorship sponsorship = Sponsorship(_msgSender());
        require(indexOfSponsorships[sponsorship] > 0, "error_notMyStakedSponsorship");
        _removeSponsorship(sponsorship, receivedPayoutWei);
    }

    function onReviewRequest(address targetOperator) external {
        require(SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(_msgSender()) > 0, "error_onlySponsorship");
        Sponsorship sponsorship = Sponsorship(_msgSender());
        emit ReviewRequest(sponsorship, targetOperator, sponsorship.flagMetadataJson(targetOperator));
    }

    ////////////////////////////////////////
    // POLICY MODULES
    ////////////////////////////////////////

    function setDelegationPolicy(IDelegationPolicy policy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        delegationPolicy = policy;
        moduleCall(address(delegationPolicy), abi.encodeWithSelector(delegationPolicy.setParam.selector, param), "error_setDelegationPolicyFailed");
    }

    function setYieldPolicy(IPoolYieldPolicy policy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        yieldPolicy = policy;
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.setParam.selector, param), "error_setYieldPolicyFailed");
    }

    function setUndelegationPolicy(IUndelegationPolicy policy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        undelegationPolicy = policy;
        moduleCall(address(undelegationPolicy), abi.encodeWithSelector(undelegationPolicy.setParam.selector, param), "error_setUndelegationPolicyFailed");
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
        require(_msgSender() == address(this), "error_mustBeThis");

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

    /** Call a module's view function via staticcall to local fallback */
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

    ////////////////////////////////////////////////////////////////////////
    // POOL VALUE UPDATING convenience methods: find unwithdrawn earnings
    ////////////////////////////////////////////////////////////////////////

    /**
     * Unwithdrawn earnings in the Sponsorship, minus operator's share of the earnings
     * This is the part the belongs to the pool, and will be used in calculating the update penalty threshold
     **/
    function getEarningsFromSponsorship(Sponsorship sponsorship) public view returns (uint earnings) {
        uint alloc = sponsorship.getEarnings(address(this));
        uint operatorsCutWei = operatorsCutFraction * alloc / 1 ether;
        return alloc - operatorsCutWei;
    }

    /**
     * Convenience method to get all sponsorship values
     * The operator needs to keep an eye on the accumulated earnings at all times, so that the pool value approximation is not too far off.
     * If someone else notices that there's too much unwithdrawn earnings, they can call withdrawEarningsFromSponsorships to get a small reward
     * @dev Don't call from other smart contracts in a transaction, could be expensive!
     **/
    function getEarningsFromSponsorships() external view returns (
        address[] memory sponsorshipAddresses,
        uint[] memory earnings
    ) {
        sponsorshipAddresses = new address[](sponsorships.length);
        earnings = new uint[](sponsorships.length);
        for (uint i = 0; i < sponsorships.length; i++) {
            sponsorshipAddresses[i] = address(sponsorships[i]);
            earnings[i] = getEarningsFromSponsorship(sponsorships[i]); // earnings - operator's share of earnings
        }
    }

    /**
     * Get the accurate total pool value; can be compared off-chain against getApproximatePoolValue
     * If the difference is too large, call withdrawEarningsFromSponsorships to get a small reward
     * @dev Don't call from other smart contracts in a transaction, could be expensive!
     */
    function calculatePoolValueInData() external view returns (uint poolValue) {
        poolValue = getApproximatePoolValue();
        for (uint i = 0; i < sponsorships.length; i++) {
            poolValue += getEarningsFromSponsorship(sponsorships[i]);
        }
    }
}
