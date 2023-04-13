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
import "./IBroker.sol";
import "./IBrokerPoolLivenessRegistry.sol";
import "./BrokerPoolPolicies/IPoolJoinPolicy.sol";
import "./BrokerPoolPolicies/IPoolYieldPolicy.sol";
import "./BrokerPoolPolicies/IPoolExitPolicy.sol";

import "./StreamrConfig.sol";
import "./Bounty.sol";
import "./BountyFactory.sol";

// import "hardhat/console.sol";

/**
 * BrokerPool receives the delegators' tokens and stakes them to Bounties of the streams that the broker services
 * It also is an ERC20 token that each delegator receives and can swap back to DATA when they want to undelegate from the pool
 *
 * The whole token balance of the pool IS THE SAME AS the "free funds", so there's no need to track the unallocated tokens separately
 */
contract BrokerPool is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable, ERC20Upgradeable, IBroker { //}, ERC2771Context {

    event Delegated(address indexed delegator, uint amountWei);
    event Undelegated(address indexed delegator, uint amountWei);
    event Staked(Bounty indexed bounty, uint amountWei);
    event Losses(Bounty indexed bounty, uint amountWei);
    event Unstaked(Bounty indexed bounty, uint stakeWei, uint gainsWei);
    event QueuedDataPayout(address user, uint amountPoolTokenWei); // TODO: user -> delegator
    event QueueUpdated(address user, uint amountPoolTokenWei); // TODO: user -> delegator
    event NodesSet(address[] nodes);
    event Heartbeat(address indexed nodeAddress, string jsonData);

    event ReviewRequest(Bounty indexed bounty, address indexed targetBroker);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    IPoolJoinPolicy public joinPolicy;
    IPoolYieldPolicy public yieldPolicy;
    IPoolExitPolicy public exitPolicy;

    StreamrConfig public streamrConfig;

    address public broker;
    IERC677 public token;

    Bounty[] public bounties;
    mapping(Bounty => uint) public indexOfBounties; // bounties array index PLUS ONE! use 0 as "is it already in the array?" check

    uint public minimumDelegationWei;

    // Pool value = DATA value of all stake + earnings in bounties - broker's share of those earnings
    // It can be queried / calculated in different ways:
    // 1. accurate but expensive: calculatePoolValueInData() (loops over bounties)
    // 2. approximate but always available: totalValueInBountiesWei (updated in staking/unstaking and updateApproximatePoolvalueOfBounty/Bounties)
    uint public totalValueInBountiesWei;

    mapping(Bounty => uint) public approxPoolValueOfBounty; // in Data wei

    struct UndelegationQueueEntry {
        address delegator;
        uint amountPoolTokenWei;
        uint timestamp;
    }
    mapping(uint => UndelegationQueueEntry) public undelegationQueue;
    mapping(address => uint) public totalQueuedPerDelegatorWei; // answers 'how much does delegator X have queued in total to be paid out'
    uint public queueLastIndex;
    uint public queueCurrentIndex;

    /**
     * The time the broker is given for paying out the exit queue.
     * If the front of the queue is older than maxQueueSeconds, anyone can call forceUnstake to pay out the queue.
     */
    uint public maxQueueSeconds;

    address[] public nodes;
    mapping(address => uint) public nodeIndex; // index in nodes array PLUS ONE

    modifier onlyBroker() {
        require(_msgSender() == broker, "error_onlyBroker");
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
        address brokerAddress,
        string calldata poolName,
        uint initialMinimumDelegationWei
    ) public initializer {
        __AccessControl_init();
        _setupRole(ADMIN_ROLE, brokerAddress);
        _setRoleAdmin(TRUSTED_FORWARDER_ROLE, ADMIN_ROLE); // admin can set the GSN trusted forwarder
        token = IERC677(tokenAddress);
        broker = brokerAddress;
        streamrConfig = StreamrConfig(streamrConfigAddress);
        minimumDelegationWei = initialMinimumDelegationWei;
        ERC20Upgradeable.__ERC20_init(poolName, poolName);

        // fixed queue emptying requirement is simplest for now. This ensures a diligent broker can always pay out the exit queue without getting leavePenalties
        maxQueueSeconds = streamrConfig.maxPenaltyPeriodSeconds();

        // DEFAULT_ADMIN_ROLE is needed (by factory) for setting modules
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    /** Pool value (DATA) = staked in bounties + free funds */
    function getApproximatePoolValue() public view returns (uint) {
        return totalValueInBountiesWei + token.balanceOf(address(this));
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

        if (data.length == 20) {
            // shift the 20 address bytes (= 160 bits) to end of uint256 to populate an address variable => shift by 256 - 160 = 96
            // (this is what abi.encodePacked would produce)
            address delegator;
            assembly { delegator := shr(96, calldataload(data.offset)) } // solhint-disable-line no-inline-assembly
            _delegate(delegator, amount);
        } else if (data.length == 32) {
            // assume the address was encoded by converting address -> uint -> bytes32 -> bytes
            // (already in the least significant bytes, no shifting needed; this is what abi.encode would produce)
            address delegator;
            assembly { delegator := calldataload(data.offset) } // solhint-disable-line no-inline-assembly
            _delegate(delegator, amount);
        } else {
            // check if sender is a bounty: unstaking/withdrawing from bounties will call this method
            // ignore returned tokens, handle them in unstake()/withdraw() instead
            Bounty bounty = Bounty(sender);
            if (indexOfBounties[bounty] > 0) {
                return;
            }

            _delegate(sender, amount);
        }
    }

    /** Delegate by first calling DATA.approve(brokerPool.address, amountWei) then this function */
    function delegate(uint amountWei) public payable {
        // console.log("## delegate");
        token.transferFrom(_msgSender(), address(this), amountWei);
        _delegate(_msgSender(), amountWei);
    }

    function _delegate(address delegator, uint amountWei) internal {
        if (address(joinPolicy) != address(0)) {
            uint allowedToJoin = moduleGet(abi.encodeWithSelector(joinPolicy.canJoin.selector, delegator, address(joinPolicy)), "error_joinPolicyFailed");
            require(allowedToJoin == 1, "error_joinPolicyFailed");
        }
        // remove amountWei from pool value to get the "Pool Tokens before transfer"
        uint256 amountPoolToken = moduleCall(address(yieldPolicy),
            abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector, amountWei, amountWei),
            "error_dataToPooltokenFailed"
        );
        _mint(delegator, amountPoolToken);
        // console.log("minting", amountPoolToken, "to", delegator);
        emit Delegated(delegator, amountWei);
    }

    /** Add the request to undelegate into the undelegation queue */
    function undelegate(uint amountPoolTokenWei) public {
        // console.log("## undelegate");
        require(amountPoolTokenWei > 0, "error_zeroUndelegation"); // TODO: should there be minimum undelegation amount?
        totalQueuedPerDelegatorWei[_msgSender()] += amountPoolTokenWei;
        undelegationQueue[queueLastIndex] = UndelegationQueueEntry(_msgSender(), amountPoolTokenWei, block.timestamp); // solhint-disable-line not-rely-on-time
        queueLastIndex++;
        emit QueuedDataPayout(_msgSender(), amountPoolTokenWei);
        payOutQueueWithFreeFunds(0);
    }

    /////////////////////////////////////////
    // BROKER FUNCTIONS
    /////////////////////////////////////////

    /**
     * Stake DATA tokens from free funds into Bounties.
     * Can only happen if all the delegators who want to undelegate have been paid out first.
     * This means the broker must clear the queue as part of normal operation before they can change staking allocations.
     **/
    function stake(Bounty bounty, uint amountWei) external onlyBroker {
        require(BountyFactory(streamrConfig.bountyFactory()).deploymentTimestamp(address(bounty)) > 0, "error_badBounty");
        require(queueIsEmpty(), "error_firstEmptyQueueThenStake");
        token.approve(address(bounty), amountWei);
        if (indexOfBounties[bounty] == 0) {
            bounty.stake(address(this), amountWei); // may fail if amountWei < minimumStake
            approxPoolValueOfBounty[bounty] += amountWei;
            totalValueInBountiesWei += amountWei;

            bounties.push(bounty);
            indexOfBounties[bounty] = bounties.length; // real array index + 1
            if (bounties.length == 1) {
                try IBrokerPoolLivenessRegistry(streamrConfig.brokerPoolLivenessRegistry()).registerAsLive() {} catch {}
            }
        }
        emit Staked(bounty, amountWei);
    }

    /**
     * Take out some of the stake from a bounty without completely unstaking
     * Except if you call this with targetStakeWei == 0, then it will actually call unstake
     **/
    function reduceStakeTo(Bounty bounty, uint targetStakeWei) external onlyBroker {
        // console.log("## reduceStake amountWei", amountWei);
        reduceStakeWithoutQueue(bounty, targetStakeWei);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the broker an option to free funds from Bounties to pay out the queue in parts */
    function reduceStakeWithoutQueue(Bounty bounty, uint targetStakeWei) public onlyBroker {
        if (targetStakeWei == 0) {
            unstakeWithoutQueue(bounty);
            return;
        }
        bounty.reduceStakeTo(targetStakeWei);
        updateApproximatePoolvalueOfBounty(bounty);
    }

    function withdrawEarningsFromBounty(Bounty bounty) external onlyBroker {
        updateApproximatePoolvalueOfBounty(bounty); // TODO: why is update needed before withdraw?
        withdrawEarningsFromBountyWithoutQueue(bounty);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the broker an option to free funds from Bounties to pay out the queue in parts */
    function withdrawEarningsFromBountyWithoutQueue(Bounty bounty) public onlyBroker {
        uint payoutWei = bounty.withdraw();
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector, payoutWei), "error_deductBrokersShareFailed");
        updateApproximatePoolvalueOfBounty(bounty);
    }

    /**
     * Unstake from a bounty
     * Throws if some of the stake is committed to a flag (being flagged or flagging others)
     **/
    function unstake(Bounty bounty) public onlyBroker {
        unstakeWithoutQueue(bounty);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the broker an option to free funds from Bounties to pay out the queue in parts */
    function unstakeWithoutQueue(Bounty bounty) public onlyBroker {
        uint amountStakedBeforeWei = bounty.getMyStake();
        uint balanceBeforeWei = token.balanceOf(address(this));
        bounty.unstake();
        _postUnstake(bounty, amountStakedBeforeWei, balanceBeforeWei);
    }

    /**
     * Self-service undelegation queue handling.
     * If the broker hasn't been doing its job, and undelegationQueue hasn't been paid out,
     *   anyone can come along and forceUnstake from a bounty to get the payouts rolling
     * Broker can also call this, if they want to forfeit the stake committed to flagging in a bounty (normal unstake would revert for safety)
     * @param bounty the funds (unstake) to pay out the queue
     * @param maxQueuePayoutIterations how many queue items to pay out, see getMyQueuePosition()
     */
    function forceUnstake(Bounty bounty, uint maxQueuePayoutIterations) external {
        // onlyBroker check happens only if grace period hasn't passed yet
        if (block.timestamp < undelegationQueue[queueCurrentIndex].timestamp + maxQueueSeconds) { // solhint-disable-line not-rely-on-time
            require(hasRole(ADMIN_ROLE, msg.sender), "error_onlyBroker");
        }

        uint amountStakedBeforeWei = bounty.getMyStake();
        uint balanceBeforeWei = token.balanceOf(address(this));
        bounty.forceUnstake();
        _postUnstake(bounty, amountStakedBeforeWei, balanceBeforeWei);
        payOutQueueWithFreeFunds(maxQueuePayoutIterations);
    }

    function _postUnstake(Bounty bounty, uint amountStakedBeforeWei, uint balanceBeforeWei) private {
        uint receivedWei = token.balanceOf(address(this)) - balanceBeforeWei;
        totalValueInBountiesWei -= approxPoolValueOfBounty[bounty];
        // console.log("bounties approx pool value", approxPoolValueOfBounty[bounty]);
        // console.log("unstake receivedWei", receivedWei);
        // console.log("unstake new approxPoolValue", approxPoolValue);
        approxPoolValueOfBounty[bounty] = 0;

        // TODO: here earnings are mixed together with stake. Maybe that's ok though.
        // unallocatedWei += receivedWei;
        if (receivedWei < amountStakedBeforeWei) {
            // TODO: slash handling
            uint lossesWei = amountStakedBeforeWei - receivedWei;
            emit Unstaked(bounty, receivedWei, 0);
            emit Losses(bounty, lossesWei);
        } else {
            // TODO: gains handling
            uint gainsWei = receivedWei - amountStakedBeforeWei;
            moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector, gainsWei),
                "error_yieldPolicy_deductBrokersPart_Failed");
            emit Unstaked(bounty, amountStakedBeforeWei, gainsWei);
        }

        _removeBountyFromArray(bounty);
    }

    // remove from array: replace with the last element
    function _removeBountyFromArray(Bounty bounty) internal {
        uint index = indexOfBounties[bounty] - 1; // indexOfBounties is the real array index + 1
        Bounty lastBounty = bounties[bounties.length - 1];
        bounties[index] = lastBounty;
        bounties.pop();
        indexOfBounties[lastBounty] = index + 1; // indexOfBounties is the real array index + 1
        delete indexOfBounties[bounty];
        if (bounties.length == 0) {
            try IBrokerPoolLivenessRegistry(streamrConfig.brokerPoolLivenessRegistry()).registerAsNotLive() {} catch {}
        }
    }

    ////////////////////////////////////////
    // NODE FUNCTIONALITY
    // NODE MANAGEMENT
    ////////////////////////////////////////

    function flag(Bounty bounty, address targetBroker) external onlyNodes {
        bounty.flag(targetBroker);
    }

    function voteOnFlag(Bounty bounty, address targetBroker, bytes32 voteData) external onlyNodes {
        bounty.voteOnFlag(targetBroker, voteData);
    }

    /** Nodes announce their ID and other connectivity metadata */
    function heartbeat(string calldata jsonData) external onlyNodes {
        emit Heartbeat(_msgSender(), jsonData);
    }

    mapping (address => bool) private isInNewNodes; // lookup used during the setNodeAddresses
    function setNodeAddresses(address[] calldata newNodes) external onlyBroker {
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
    function updateNodeAddresses(address[] calldata addNodes, address[] calldata removeNodes) external onlyBroker {
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
    }

    function _removeNode(address node) internal {
        uint index = nodeIndex[node] - 1;
        address lastNode = nodes[nodes.length - 1];
        nodes[index] = lastNode;
        nodes.pop();
        nodeIndex[lastNode] = index + 1;
        delete nodeIndex[node];
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
        if (balanceOf(delegator) < amountPoolTokens) {
            amountPoolTokens = balanceOf(delegator);
        }
        if (amountPoolTokens == 0) {
            // nothing to pay => pop the item
            delete undelegationQueue[queueCurrentIndex];
            queueCurrentIndex++;
            return false;
        }

        // console.log("payOutQueueWithFreeFunds amountPoolTokens", amountPoolTokens);
        uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            amountPoolTokens, 0), "error_yieldPolicy_pooltokenToData_Failed");
        if (balanceDataWei >= amountDataWei) {
            // whole amountDataWei is paid out => pop the item and swap tokens
            delete undelegationQueue[queueCurrentIndex];
            queueCurrentIndex++;
            totalQueuedPerDelegatorWei[delegator] -= amountPoolTokens;
            _burn(delegator, amountPoolTokens);
            token.transfer(delegator, amountDataWei);
            emit Undelegated(delegator, amountDataWei);
            return queueIsEmpty();
        } else {
            // whole pool's balance is paid out as a partial payment, update the item in the queue
            uint256 partialAmountPoolTokens = moduleCall(address(yieldPolicy),
                abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
                balanceDataWei, 0), "error_dataToPooltokenFailed"
            );
            totalQueuedPerDelegatorWei[delegator] -= partialAmountPoolTokens;
            UndelegationQueueEntry memory oldEntry = undelegationQueue[queueCurrentIndex];
            uint256 poolTokensLeftInQueue = oldEntry.amountPoolTokenWei - partialAmountPoolTokens;
            undelegationQueue[queueCurrentIndex] = UndelegationQueueEntry(oldEntry.delegator, poolTokensLeftInQueue, oldEntry.timestamp);
            _burn(delegator, partialAmountPoolTokens);
            token.transfer(delegator, balanceDataWei);
            emit Undelegated(delegator, balanceDataWei);
            emit QueueUpdated(delegator, poolTokensLeftInQueue);
            return false;
        }
    }

    /* solhint-enable reentrancy */

    /////////////////////////////////////////
    // BOUNTY CALLBACKS
    /////////////////////////////////////////

    function onSlash() external {
        Bounty bounty = Bounty(msg.sender);
        require(indexOfBounties[bounty] > 0, "error_notMyStakedBounty");
        updateApproximatePoolvalueOfBounty(bounty);
    }

    function onKick() external {
        Bounty bounty = Bounty(msg.sender);
        require(indexOfBounties[bounty] > 0, "error_notMyStakedBounty");
        _removeBountyFromArray(bounty);
        updateApproximatePoolvalueOfBounty(bounty);
        emit Unstaked(bounty, 0, 0);
    }

    function onReviewRequest(address targetBroker) external {
        require(BountyFactory(streamrConfig.bountyFactory()).deploymentTimestamp(msg.sender) > 0, "error_onlyBounty");
        Bounty bounty = Bounty(msg.sender);
        emit ReviewRequest(bounty, targetBroker);
    }

    ////////////////////////////////////////
    // POLICY MODULES
    ////////////////////////////////////////

    function setJoinPolicy(IPoolJoinPolicy policy, uint256 initialMargin, uint256 minimumMarginPercent) public onlyRole(DEFAULT_ADMIN_ROLE) {
        joinPolicy = policy;
        moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.setParam.selector, initialMargin, minimumMarginPercent), "error_setJoinPolicyFailed");
    }

    function setYieldPolicy(IPoolYieldPolicy policy,
        uint256 initialMargin,
        uint256 maintenanceMarginPercent,
        uint256 minimumMarginPercent,
        uint256 brokerSharePercent,
        uint256 brokerShareMaxDivertPercent) public onlyRole(DEFAULT_ADMIN_ROLE) {
        yieldPolicy = policy;
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.setParam.selector,
            initialMargin, maintenanceMarginPercent, minimumMarginPercent, brokerSharePercent,
            brokerShareMaxDivertPercent), "error_setYieldPolicyFailed");
    }

    function setExitPolicy(IPoolExitPolicy policy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        exitPolicy = policy;
        moduleCall(address(exitPolicy), abi.encodeWithSelector(exitPolicy.setParam.selector, param), "error_setExitPolicyFailed");
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
     * The broker is supposed to keep the approximate pool value up to date by calling updateApproximatePoolvalueOfBounty
     *   on the bounties that have generated most earnings = discrepancy between the approximate and the real pool value.
     */
    function updateApproximatePoolvalueOfBounty(Bounty bounty) public {
        uint actual = getPoolValueFromBounty(bounty);
        uint approx = approxPoolValueOfBounty[bounty];
        approxPoolValueOfBounty[bounty] = actual;
        totalValueInBountiesWei = totalValueInBountiesWei + actual - approx;
    }

    /**
     * The accurate "accounting value" of a bounty = stake + earnings - broker's share of the earnings
     * This value will be used to calculate the total pool value, and therefore also the pool token exchange rate
     **/
    function getPoolValueFromBounty(Bounty bounty) public view returns (uint256 poolValue) {
        uint alloc = bounty.getEarnings(address(this));
        uint share = moduleGet(abi.encodeWithSelector(yieldPolicy.calculateBrokersShare.selector, alloc, address(yieldPolicy)), "error_calculateBrokersShare_Failed");
        poolValue = bounty.getMyStake() + alloc - share;
    }

    /**
     * Convenience method to get all (approximate) bounty values
     * The broker needs to keep an eye on the approximate values at all times, so that the approximation is not too far off.
     * If someone else notices that the approximation is too far off, they can call updateApproximatePoolvalueOfBounties to get a small prize (paid from broker's pool tokens)
     * @dev Don't call from other smart contracts in a transaction, could be expensive!
     **/
    function getApproximatePoolValuesPerBounty() external view returns (
        address[] memory bountyAddresses,
        uint[] memory approxValues,
        uint[] memory realValues
    ) {
        bountyAddresses = new address[](bounties.length);
        approxValues = new uint[](bounties.length);
        realValues = new uint[](bounties.length);
        for (uint i = 0; i < bounties.length; i++) {
            bountyAddresses[i] = address(bounties[i]);
            approxValues[i] = approxPoolValueOfBounty[bounties[i]];
            realValues[i] = getPoolValueFromBounty(bounties[i]);
        }
    }

    /**
     * Get the accurate total pool value; can be compared off-chain against getApproximatePoolValue
     * If the difference is too large. call updateApproximatePoolvalueOfBounties to get a small prize (paid from broker's pool tokens)
     * @dev Don't call from other smart contracts in a transaction, could be expensive!
     * TODO: is this function needed? getApproximatePoolValuesPerBounty gives same info, and more
     */
    function calculatePoolValueInData() external view returns (uint256 poolValue) {
        poolValue = token.balanceOf(address(this));
        for (uint i = 0; i < bounties.length; i++) {
            poolValue += getPoolValueFromBounty(bounties[i]);
        }
    }

    /**
     * If the difference between calculatePoolValueInData() and getApproximatePoolValue() becomes too large,
     *   then anyone can call this method and point out a set of bounties that together sum up to poolValueDriftLimitFraction
     * Caller gets rewarded poolValueDriftPenaltyFraction of the broker's pool tokens
     */
    function updateApproximatePoolvalueOfBounties(Bounty[] memory bountyAddresses) public {
        uint sumActual = 0;
        uint sumApprox = 0;
        for (uint i = 0; i < bountyAddresses.length; i++) {
            Bounty bounty = bountyAddresses[i];
            uint actual = getPoolValueFromBounty(bounty);
            uint approx = approxPoolValueOfBounty[bounty];
            sumActual += actual;
            sumApprox += approx;

            approxPoolValueOfBounty[bounty] = actual;
        }
        totalValueInBountiesWei = totalValueInBountiesWei + sumActual - sumApprox;

        // if total difference is more than allowed, then slash the broker a bit: move some of their pool tokens to reward the caller
        // TODO: this could move pool tokens to someone who isn't delegated into the pool! TODO: Add them if they're not in the pool?
        uint allowedDifference = getApproximatePoolValue() * streamrConfig.poolValueDriftLimitFraction() / 1 ether;
        if (sumActual > sumApprox + allowedDifference) {
            _transfer(broker, _msgSender(), balanceOf(broker) * streamrConfig.poolValueDriftPenaltyFraction() / 1 ether);
        }
    }
}
