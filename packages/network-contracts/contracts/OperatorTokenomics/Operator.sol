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

// TODO ETH-517: replace interface with import
interface IStreamRegistry {
    enum PermissionType { Edit, Delete, Publish, Subscribe, Grant }

    function createStream(string calldata streamIdPath, string calldata metadataJsonString) external;
    function updateStreamMetadata(string calldata streamId, string calldata metadata) external;
    function grantPublicPermission(string calldata streamId, PermissionType permissionType) external;
    function grantPermission(string calldata streamId, address user, PermissionType permissionType) external;
    function revokePermission(string calldata streamId, address user, PermissionType permissionType) external;
    function addressToString(address _address) external pure returns(string memory);
}

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
    event Delegated(address indexed delegator, uint amountWei, uint approxPoolValue);
    event Undelegated(address indexed delegator, uint amountWei, uint approxPoolValue);
    event BalanceUpdate(address delegator, uint newPoolTokenWei);
    event QueuedDataPayout(address delegator, uint amountPoolTokenWei);
    event QueueUpdated(address delegator, uint amountPoolTokenWei);

    // sponsorship events (initiated by CONTROLLER_ROLE)
    event Staked(Sponsorship indexed sponsorship);
    event Unstaked(Sponsorship indexed sponsorship);
    event StakeUpdate(Sponsorship indexed sponsorship, uint amountWei, uint approxPoolValue);
    event Profit(Sponsorship indexed sponsorship, uint poolIncreaseWei, uint operatorsShareWei);
    event Loss(Sponsorship indexed sponsorship, uint poolDecreaseWei);

    // node events (initiated by nodes)
    event Heartbeat(address indexed nodeAddress, string jsonData);
    event ReviewRequest(Sponsorship indexed sponsorship, address indexed targetOperator);

    // operator admin events
    event NodesSet(address[] nodes);
    event MetadataUpdated(string metadataJsonString, address indexed operatorAddress); // = owner() of this contract

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    IDelegationPolicy public delegationPolicy;
    IPoolYieldPolicy public yieldPolicy;
    IUndelegationPolicy public undelegationPolicy;

    StreamrConfig public streamrConfig;

    address public owner;
    IERC677 public token;
    uint public operatorsShareFraction; // 1 ether == 100%, like in tokens

    Sponsorship[] public sponsorships;
    mapping(Sponsorship => uint) public indexOfSponsorships; // sponsorships array index PLUS ONE! use 0 as "is it already in the array?" check

    uint public minimumDelegationWei;

    // Pool value = DATA value of all stake + earnings in sponsorships - operator's share of those earnings
    // It can be queried / calculated in different ways:
    // 1. accurate but expensive: calculatePoolValueInData() (loops over sponsorships)
    // 2. approximate but always available: totalValueInSponsorshipsWei (updated in staking/unstaking and updateApproximatePoolvalueOfSponsorship/Sponsorships)
    uint public totalValueInSponsorshipsWei;

    mapping(Sponsorship => uint) public approxPoolValueOfSponsorship; // in Data wei
    mapping(Sponsorship => uint) public stakedInto; // in Data wei

    struct UndelegationQueueEntry {
        address delegator;
        uint amountPoolTokenWei;
        uint timestamp;
    }
    mapping(uint => UndelegationQueueEntry) public undelegationQueue;
    uint public queueLastIndex;
    uint public queueCurrentIndex;

    /**
     * The time the operator is given for paying out the undelegation queue.
     * If the front of the queue is older than maxQueueSeconds, anyone can call forceUnstake to pay out the queue.
     */
    uint public maxQueueSeconds;

    address[] public nodes;
    mapping(address => uint) public nodeIndex; // index in nodes array PLUS ONE

    IStreamRegistry public streamRegistry;
    string public streamId;
    string public metadata;

    modifier onlyOperator() {
        require(hasRole(CONTROLLER_ROLE, msg.sender), "error_onlyOperator");
        _;
    }

    modifier onlyNodes() {
        require(nodeIndex[_msgSender()] > 0, "error_onlyNodes");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(
        address tokenAddress,
        address streamrConfigAddress,
        address ownerAddress,
        string[2] memory operatorParams, // poolTokenName, streamPath
        uint initialMinimumDelegationWei,
        uint operatorsShare
    ) public initializer {
        __AccessControl_init();
        _setupRole(OWNER_ROLE, ownerAddress);
        _setupRole(CONTROLLER_ROLE, ownerAddress);
        _setRoleAdmin(CONTROLLER_ROLE, OWNER_ROLE); // owner sets the controllers
        _setRoleAdmin(TRUSTED_FORWARDER_ROLE, CONTROLLER_ROLE); // controller can set the GSN trusted forwarder
        token = IERC677(tokenAddress);
        owner = ownerAddress;
        streamrConfig = StreamrConfig(streamrConfigAddress);
        minimumDelegationWei = initialMinimumDelegationWei;
        ERC20Upgradeable.__ERC20_init(operatorParams[0], operatorParams[0]);

        // A fixed queue emptying requirement is simplest for now.
        // This ensures a diligent operator can always pay out the undelegation queue without getting leavePenalties
        maxQueueSeconds = streamrConfig.maxPenaltyPeriodSeconds();
        operatorsShareFraction = operatorsShare;

        // DEFAULT_ADMIN_ROLE is needed (by factory) for setting modules
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

        metadata = operatorParams[1];
        emit MetadataUpdated(operatorParams[1], ownerAddress);

        _createOperatorStream();
    }

    /**
     * Each operator contract creates a fleet coordination stream upon creation,
     *   id = <operatorContractAddress>/operator/coordination
     */
    function _createOperatorStream() private {
        streamRegistry = IStreamRegistry(streamrConfig.streamRegistryAddress());
        // TODO: avoid this stream.concat once streamRegistry.createStream returns the streamId (ETH-505)
        streamId = string.concat(streamRegistry.addressToString(address(this)), "/operator/coordination");
        streamRegistry.createStream("/operator/coordination", "{}");
        streamRegistry.grantPublicPermission(streamId, IStreamRegistry.PermissionType.Subscribe);
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function _transfer(address from, address to, uint amount) internal override {
        require(balanceOf(from) >= amount + minimumDelegationWei, "error_minDelegationNotReached");
        super._transfer(from, to, amount);
        emit BalanceUpdate(from, balanceOf(from));
        emit BalanceUpdate(to, balanceOf(to));
    }

    /** Pool value (DATA) = staked in sponsorships + free funds */
    function getApproximatePoolValue() public view returns (uint) {
        return totalValueInSponsorshipsWei + token.balanceOf(address(this));
    }

    function getMyBalanceInData() public view returns (uint256 amountDataWei) {
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
        emit MetadataUpdated(metadataJsonString, owner);
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
            // assume the address was encoded by converting address -> uint -> bytes32 -> bytes
            // (already in the least significant bytes, no shifting needed; this is what abi.encode would produce)
            assembly { delegator := calldataload(data.offset) } // solhint-disable-line no-inline-assembly
        }
        _delegate(delegator, amount);
    }

    /** Delegate by first calling DATA.approve(operatorContract.address, amountWei) then this function */
    function delegate(uint amountWei) public payable {
        // console.log("## delegate");
        token.transferFrom(_msgSender(), address(this), amountWei);
        _delegate(_msgSender(), amountWei);
    }

    function _delegate(address delegator, uint amountWei) internal {
        if (address(delegationPolicy) != address(0) && delegator != owner) {
            uint allowedToJoin = moduleGet(abi.encodeWithSelector(delegationPolicy.canJoin.selector, delegator, address(delegationPolicy)), "error_joinPolicyFailed");
            require(allowedToJoin == 1, "error_joinPolicyFailed");
        }
        // remove amountWei from pool value to get the "Pool Tokens before transfer"
        uint256 amountPoolToken = moduleCall(address(yieldPolicy),
            abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector, amountWei, amountWei),
            "error_dataToPooltokenFailed"
        );
        _mint(delegator, amountPoolToken);
        emit Delegated(delegator, amountWei, getApproximatePoolValue());
        emit BalanceUpdate(delegator, balanceOf(delegator));
    }

    /** Add the request to undelegate into the undelegation queue */
    function undelegate(uint amountPoolTokenWei) public {
        // console.log("## undelegate");
        require(amountPoolTokenWei > 0, "error_zeroUndelegation"); // TODO: should there be minimum undelegation amount?
        undelegationQueue[queueLastIndex] = UndelegationQueueEntry(_msgSender(), amountPoolTokenWei, block.timestamp); // solhint-disable-line not-rely-on-time
        queueLastIndex++;
        emit QueuedDataPayout(_msgSender(), amountPoolTokenWei);
        payOutQueueWithFreeFunds(0);
    }

    /////////////////////////////////////////
    // OPERATOR FUNCTIONS
    /////////////////////////////////////////

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
        approxPoolValueOfSponsorship[sponsorship] += amountWei;
        stakedInto[sponsorship] += amountWei;
        totalValueInSponsorshipsWei += amountWei;

        if (indexOfSponsorships[sponsorship] == 0) { // initial staking in a new sponsorship
            sponsorships.push(sponsorship);
            indexOfSponsorships[sponsorship] = sponsorships.length; // real array index + 1
            if (sponsorships.length == 1) {
                try IOperatorLivenessRegistry(streamrConfig.operatorLivenessRegistry()).registerAsLive() {} catch {}
            }
            emit Staked(sponsorship);
        }
        emit StakeUpdate(sponsorship, sponsorship.stakedWei(address(this)), totalValueInSponsorshipsWei);
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
        updateApproximatePoolvalueOfSponsorship(sponsorship);
        emit StakeUpdate(sponsorship, sponsorship.stakedWei(address(this)), totalValueInSponsorshipsWei);
    }

    function withdrawEarningsFromSponsorship(Sponsorship sponsorship) external onlyOperator {
        updateApproximatePoolvalueOfSponsorship(sponsorship); // TODO: why is update needed before withdraw?
        withdrawEarningsFromSponsorshipWithoutQueue(sponsorship);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Bounties to pay out the queue in parts */
    function withdrawEarningsFromSponsorshipWithoutQueue(Sponsorship sponsorship) public onlyOperator {
        uint earningsDataWei = sponsorship.withdraw();
        // "self-delegate" the operator's share === mint new pooltokens
        uint operatorsShareDataWei = earningsDataWei * operatorsShareFraction / 1 ether;
        updateApproximatePoolvalueOfSponsorship(sponsorship);
        _delegate(owner, operatorsShareDataWei);
        emit Profit(sponsorship, earningsDataWei - operatorsShareDataWei, operatorsShareDataWei);
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
        if (block.timestamp < undelegationQueue[queueCurrentIndex].timestamp + maxQueueSeconds) { // solhint-disable-line not-rely-on-time
            require(hasRole(CONTROLLER_ROLE, msg.sender), "error_onlyOperator");
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
        if (receivedDuringUnstakingWei < stakedInto[sponsorship]) {
            uint lossWei = stakedInto[sponsorship] - receivedDuringUnstakingWei;
            emit Loss(sponsorship, lossWei);
        } else {
            // "self-delegate" the operator's share === mint new pooltokens
            uint profitDataWei = receivedDuringUnstakingWei - stakedInto[sponsorship];
            uint operatorsShareDataWei = profitDataWei * operatorsShareFraction / 1 ether;
            _delegate(owner, operatorsShareDataWei);
            emit Profit(sponsorship, profitDataWei - operatorsShareDataWei, operatorsShareDataWei);
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

        totalValueInSponsorshipsWei -= approxPoolValueOfSponsorship[sponsorship];
        approxPoolValueOfSponsorship[sponsorship] = 0;
        stakedInto[sponsorship] = 0;
        emit Unstaked(sponsorship);
        emit StakeUpdate(sponsorship, 0, totalValueInSponsorshipsWei);
    }

    ////////////////////////////////////////
    // NODE FUNCTIONALITY
    // NODE MANAGEMENT
    ////////////////////////////////////////

    function flag(Sponsorship sponsorship, address targetOperator) external onlyNodes {
        sponsorship.flag(targetOperator);
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

        streamRegistry.grantPermission(streamId, node, IStreamRegistry.PermissionType.Publish);
    }

    function _removeNode(address node) internal {
        uint index = nodeIndex[node] - 1;
        address lastNode = nodes[nodes.length - 1];
        nodes[index] = lastNode;
        nodes.pop();
        nodeIndex[lastNode] = index + 1;
        delete nodeIndex[node];

        streamRegistry.revokePermission(streamId, node, IStreamRegistry.PermissionType.Publish);
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
        // TODO: instead of special-casing maxIterations zero, call with a large value?
        if (maxIterations == 0) { maxIterations = 1 ether; } // see TODO above
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

        // take the first element from the queue, and silently cap it to the amount of pool tokens the exiting delegator has
        address delegator = undelegationQueue[queueCurrentIndex].delegator;
        uint amountPoolTokens = undelegationQueue[queueCurrentIndex].amountPoolTokenWei;
        // TODO: if delegator == owner, then cap the amountPoolTokens so that operator/owner can't get below minimumMarginFraction
        if (balanceOf(delegator) < amountPoolTokens) {
            amountPoolTokens = balanceOf(delegator);
        }
        if (amountPoolTokens == 0) {
            // nothing to pay => pop the item
            // will this actually do anything? Or delete just resets to default value which is anyway zero?
            // actually it will remove the struct (I think)
            delete undelegationQueue[queueCurrentIndex];
            queueCurrentIndex++;
            return false;
        }

        // console.log("payOutFirstInQueue amountPoolTokens", amountPoolTokens);
        uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            amountPoolTokens, 0), "error_yieldPolicy_pooltokenToData_Failed");
        if (balanceDataWei >= amountDataWei) {
            // whole amountDataWei is paid out => pop the item and swap tokens
            delete undelegationQueue[queueCurrentIndex];
            queueCurrentIndex++;
            _burn(delegator, amountPoolTokens);
            emit BalanceUpdate(delegator, balanceOf(delegator));
            token.transfer(delegator, amountDataWei);
            emit Undelegated(delegator, amountDataWei, totalValueInSponsorshipsWei);
            return queueIsEmpty();
        } else {
            // whole pool's balance is paid out as a partial payment, update the item in the queue
            uint256 partialAmountPoolTokens = moduleCall(address(yieldPolicy),
                abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
                balanceDataWei, 0), "error_dataToPooltokenFailed"
            );
            UndelegationQueueEntry memory oldEntry = undelegationQueue[queueCurrentIndex];
            uint256 poolTokensLeftInQueue = oldEntry.amountPoolTokenWei - partialAmountPoolTokens;
            undelegationQueue[queueCurrentIndex] = UndelegationQueueEntry(oldEntry.delegator, poolTokensLeftInQueue, oldEntry.timestamp);
            _burn(delegator, partialAmountPoolTokens);
            emit BalanceUpdate(delegator, balanceOf(delegator));
            token.transfer(delegator, balanceDataWei);
            emit Undelegated(delegator, balanceDataWei, totalValueInSponsorshipsWei);
            emit QueueUpdated(delegator, poolTokensLeftInQueue);
            return false;
        }
    }

    /* solhint-enable reentrancy */

    /////////////////////////////////////////
    // SPONSORSHIP CALLBACKS
    /////////////////////////////////////////

    function onSlash(uint) external {
        Sponsorship sponsorship = Sponsorship(msg.sender);
        require(indexOfSponsorships[sponsorship] > 0, "error_notMyStakedSponsorship");
        updateApproximatePoolvalueOfSponsorship(sponsorship);
    }

    function onKick(uint, uint receivedPayoutWei) external {
        Sponsorship sponsorship = Sponsorship(msg.sender);
        require(indexOfSponsorships[sponsorship] > 0, "error_notMyStakedSponsorship");
        _removeSponsorship(sponsorship, receivedPayoutWei);
        updateApproximatePoolvalueOfSponsorship(sponsorship);
    }

    function onReviewRequest(address targetOperator) external {
        require(SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(msg.sender) > 0, "error_onlySponsorship");
        Sponsorship sponsorship = Sponsorship(msg.sender);
        emit ReviewRequest(sponsorship, targetOperator);
    }

    ////////////////////////////////////////
    // POLICY MODULES
    ////////////////////////////////////////

    function setDelegationPolicy(IDelegationPolicy policy, uint256 initialMargin, uint256 minimumMarginFraction) public onlyRole(DEFAULT_ADMIN_ROLE) {
        delegationPolicy = policy;
        moduleCall(address(delegationPolicy), abi.encodeWithSelector(delegationPolicy.setParam.selector, initialMargin, minimumMarginFraction), "error_setDelegationPolicyFailed");
    }

    function setYieldPolicy(IPoolYieldPolicy policy, uint256 param) public onlyRole(DEFAULT_ADMIN_ROLE) {
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
        require(msg.sender == address(this), "error_mustBeThis");

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

    ////////////////////////////////////////
    // POOL VALUE UPDATING + incentivization
    ////////////////////////////////////////

    /**
     * The operator is supposed to keep the approximate pool value up to date by calling updateApproximatePoolvalueOfSponsorship
     *   on the sponsorships that have generated most earnings = discrepancy between the approximate and the real pool value.
     */
    function updateApproximatePoolvalueOfSponsorship(Sponsorship sponsorship) public {
        uint actual = getPoolValueFromSponsorship(sponsorship);
        uint approx = approxPoolValueOfSponsorship[sponsorship];
        approxPoolValueOfSponsorship[sponsorship] = actual;
        totalValueInSponsorshipsWei = totalValueInSponsorshipsWei + actual - approx;
    }

    /**
     * The accurate "accounting value" of a sponsorship = stake + earnings - operator's share of the earnings
     * This value will be used to calculate the total pool value, and therefore also the pool token exchange rate
     **/
    function getPoolValueFromSponsorship(Sponsorship sponsorship) public view returns (uint256 poolValue) {
        uint alloc = sponsorship.getEarnings(address(this));
        uint operatorShare = operatorsShareFraction * alloc / 1 ether;
        poolValue = sponsorship.getMyStake() + alloc - operatorShare;
    }

    /**
     * Convenience method to get all (approximate) sponsorship values
     * The operator needs to keep an eye on the approximate values at all times, so that the approximation is not too far off.
     * If someone else notices that the approximation is too far off, they can call updateApproximatePoolvalueOfSponsorships to get a small prize (paid from operator's pool tokens)
     * @dev Don't call from other smart contracts in a transaction, could be expensive!
     **/
    function getApproximatePoolValuesPerSponsorship() external view returns (
        address[] memory sponsorshipAddresses,
        uint[] memory approxValues,
        uint[] memory realValues
    ) {
        sponsorshipAddresses = new address[](sponsorships.length);
        approxValues = new uint[](sponsorships.length);
        realValues = new uint[](sponsorships.length);
        for (uint i = 0; i < sponsorships.length; i++) {
            sponsorshipAddresses[i] = address(sponsorships[i]);
            approxValues[i] = approxPoolValueOfSponsorship[sponsorships[i]];
            realValues[i] = getPoolValueFromSponsorship(sponsorships[i]);
        }
    }

    /**
     * Get the accurate total pool value; can be compared off-chain against getApproximatePoolValue
     * If the difference is too large. call updateApproximatePoolvalueOfSponsorships to get a small prize (paid from operator's pool tokens)
     * @dev Don't call from other smart contracts in a transaction, could be expensive!
     * TODO: is this function needed? getApproximatePoolValuesPerSponsorship gives same info, and more
     */
    function calculatePoolValueInData() external view returns (uint256 poolValue) {
        poolValue = token.balanceOf(address(this));
        for (uint i = 0; i < sponsorships.length; i++) {
            poolValue += getPoolValueFromSponsorship(sponsorships[i]);
        }
    }

    /**
     * If the difference between calculatePoolValueInData() and getApproximatePoolValue() becomes too large,
     *   then anyone can call this method and point out a set of sponsorships that together sum up to poolValueDriftLimitFraction
     * Caller gets rewarded poolValueDriftPenaltyFraction of the operator's pool tokens
     */
    function updateApproximatePoolvalueOfSponsorships(Sponsorship[] memory sponsorshipAddresses) public {
        uint sumActual = 0;
        uint sumApprox = 0;
        for (uint i = 0; i < sponsorshipAddresses.length; i++) {
            Sponsorship sponsorship = sponsorshipAddresses[i];
            uint actual = getPoolValueFromSponsorship(sponsorship);
            uint approx = approxPoolValueOfSponsorship[sponsorship];
            sumActual += actual;
            sumApprox += approx;

            approxPoolValueOfSponsorship[sponsorship] = actual;
        }
        totalValueInSponsorshipsWei = totalValueInSponsorshipsWei + sumActual - sumApprox;

        // if total difference is more than allowed, then slash the operator a bit: move some of their pool tokens to reward the caller
        // TODO: this could move pool tokens to someone who isn't delegated into the pool! TODO: Add them if they're not in the pool?
        uint allowedDifference = getApproximatePoolValue() * streamrConfig.poolValueDriftLimitFraction() / 1 ether;
        if (sumActual > sumApprox + allowedDifference) {
            uint penaltyWei = balanceOf(owner) * streamrConfig.poolValueDriftPenaltyFraction() / 1 ether;
            _transfer(owner, _msgSender(), penaltyWei);
        }
    }
}
