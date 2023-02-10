// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

import "../IERC677.sol";
import "../IERC677Receiver.sol";
import "../Bounties/ISlashListener.sol";

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../Bounties/Bounty.sol";
import "../StreamrConstants.sol";
import "./policies/IPoolJoinPolicy.sol";
import "./policies/IPoolYieldPolicy.sol";
import "./policies/IPoolExitPolicy.sol";

// import "hardhat/console.sol";

/**
 * BrokerPool receives the delegators' investments and pays out yields
 * It also is an ERC20 token for the pool tokens that each delegator receives and can swap back to DATA when they want to exit the pool
 *
 * The whole token balance of the pool IS SAME AS the "free funds", so there's no need to track the unallocated tokens separately
 */
contract BrokerPool is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable, ERC20Upgradeable, ISlashListener { //}, ERC2771Context {

    event InvestmentReceived(address indexed investor, uint amountWei);
    event InvestmentReturned(address indexed investor, uint amountWei);
    event Staked(Bounty indexed bounty, uint amountWei);
    event Losses(Bounty indexed bounty, uint amountWei);
    event Unstaked(Bounty indexed bounty, uint stakeWei, uint gainsWei);
    event QueuedDataPayout(address user, uint amountPoolTokenWei);
    event QueueUpdated(address user, uint amountPoolTokenWei);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    uint public minimumDelegationWei;

    /**
     * The time the broker is given for paying out the exit queue.
     * If the front of the queue is older than gracePeriodSeconds, anyone can call forceUnstake to pay out the queue.
     */
    uint public gracePeriodSeconds;
    IPoolJoinPolicy public joinPolicy;
    IPoolYieldPolicy public yieldPolicy;
    IPoolExitPolicy public exitPolicy;

    struct GlobalStorage {
        address broker;
        IERC677 token;
        uint approxPoolValue; // in Data wei
        StreamrConstants streamrConstants;
    }

    Bounty[] public bounties;
    mapping(Bounty => uint) public indexOfBounties; // real array index PLUS ONE! use 0 as "is it already in the array?" check

    struct PayoutQueueEntry {
        address user;
        uint amountPoolTokenWei;
        uint timestamp;
    }
    mapping(uint => PayoutQueueEntry) public payoutQueue;
    // answers 'how much do i have queued in total to be paid out'
    mapping(address => uint) public queuedPayoutsPerUser;
    uint public queueLength;
    uint public queuePayoutIndex;

    // triple bookkeeping
    // 1. real actual poolvalue = local free funds + stake in bounties + allocation in bounties; loops over bounties
    // 2. val = Sum over local mapping approxPoolValueOfBounty + free funds
    // 3. val = approxPoolValue in globalstorage
    mapping(Bounty => uint) public approxPoolValueOfBounty; // in Data wei

    modifier onlyBroker() {
        require(msg.sender == globalData().broker, "error_onlyBroker");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(
        address tokenAddress,
        address streamrConstants,
        address brokerAddress,
        string calldata poolName,
        uint initialMinimumDelegationWei
    ) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // _setupRole(ADMIN_ROLE, newOwner);
        // _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE); // admins can make others admin, too
        globalData().token = IERC677(tokenAddress);
        globalData().broker = brokerAddress;
        globalData().streamrConstants = StreamrConstants(streamrConstants);
        minimumDelegationWei = initialMinimumDelegationWei;
        ERC20Upgradeable.__ERC20_init(poolName, poolName);

        // fixed grace period is simplest for now. This ensures a diligent broker can always pay out the exit queue without getting slashed.
        gracePeriodSeconds = globalData().streamrConstants.MAX_PENALTY_PERIOD_SECONDS();
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function globalData() internal pure returns(GlobalStorage storage data) {
        bytes32 storagePosition = keccak256("brokerpool.storage.GlobalStorage");
        assembly {data.slot := storagePosition}
    }

    function getApproximatePoolValue() external view returns (uint) {
        return globalData().approxPoolValue;
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

    /////////////////////////////////////////
    // INVESTOR FUNCTIONS
    /////////////////////////////////////////

    /**
     * ERC677 token callback
     * If the data bytes contains an address, the incoming tokens are invested on behalf of that delegator
     * If not, the token sender is the investor
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        // console.log("## onTokenTransfer from", sender);
        // console.log("onTokenTransfer amount", amount);
        require(_msgSender() == address(globalData().token), "error_onlyTokenContract");

        // check if sender is a bounty: unstaking from bounties will call this method
        // ignore returned tokens, handle them in unstake() instead
        Bounty bounty = Bounty(sender);
        if (indexOfBounties[bounty] > 0) {
            return;
        }

        if (data.length == 20) {
            // shift 20 bytes (= 160 bits) to end of uint256 to make it an address => shift by 256 - 160 = 96
            // (this is what abi.encodePacked would produce)
            address investor;
            assembly {
                investor := shr(96, calldataload(data.offset))
            }
            _invest(investor, amount);
        } else if (data.length == 32) {
            // assume the address was encoded by converting address -> uint -> bytes32 -> bytes (already in the least significant bytes)
            // (this is what abi.encode would produce)
            address investor;
            assembly {
                investor := calldataload(data.offset)
            }
            _invest(investor, amount);
        } else {
            _invest(sender, amount);
        }
    }

    /** Invest by first calling ERC20.approve(brokerPool.address, amountWei) then this function */
    function invest(uint amountWei) public payable {
        // console.log("## invest");
        globalData().token.transferFrom(_msgSender(), address(this), amountWei);
        _invest(_msgSender(), amountWei);
    }

    function _invest(address investor, uint amountWei) internal {
        // console.log("## _invest");
        // unallocatedWei += amountWei;
        // console.log("_invest investor", investor, "amountWei", amountWei);
        // if we have a join policy
        globalData().approxPoolValue += amountWei;
        if (address(joinPolicy) != address(0)) {
            // check if the investor is allowed to join
            uint allowed = moduleGet(abi.encodeWithSelector(joinPolicy.canJoin.selector, investor, address(joinPolicy)), "error_joinPolicyFailed");
            // console.log("_invest allowed", allowed);
            require(allowed == 1, "error_joinPolicyFailed");
        }
        // remove amountWei from pool value to get the "Pool Tokens before transfer"
        uint256 amountPoolToken = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector, amountWei, amountWei), "error_yieldPolicy_dataToPooltoken_Failed");
        _mint(investor, amountPoolToken);
        // console.log("minting", amountPoolToken, "to", investor);
        emit InvestmentReceived(investor, amountWei);
    }

    // function withdraw(uint amountPoolTokenWei) public {
    //     // token.transferAndCall(_msgSender(), amountWei, "0x");
    //     // console.log("withdraw amountPoolTokenWei", amountPoolTokenWei);
    //     // console.log("balance msgSender ", balanceOf(_msgSender()));
    //     uint256 calculatedAmountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
    //         amountPoolTokenWei), "error_yieldPolicyFailed");
    //     // console.log("withdraw calculatedAmountDataWei", calculatedAmountDataWei);
    //     _burn(_msgSender(), amountPoolTokenWei);
    //     uint poolDataBalance = globalData().token.balanceOf(address(this));
    //     // console.log("withdraw poolDataBalance", poolDataBalance);
    //     if (calculatedAmountDataWei > poolDataBalance) {
    //         queuedPayoutsDataWei[_msgSender()] = calculatedAmountDataWei - poolDataBalance;
    //         // console.log("withdraw #", calculatedAmountDataWei - poolDataBalance);
    //         // console.log("msgSender", _msgSender(), "queuedPayoutsWei", queuedPayoutsDataWei[_msgSender()]);
    //         calculatedAmountDataWei = poolDataBalance;
    //     }
    //     // console.log("withdraw calculatedAmountDataWei", calculatedAmountDataWei);
    //     globalData().token.transfer(_msgSender(), calculatedAmountDataWei);
    //     emit InvestmentReturned(_msgSender(), calculatedAmountDataWei);
    //     // unallocatedWei -= amountWei;
    // }

    /////////////////////////////////////////
    // BROKER FUNCTIONS
    /////////////////////////////////////////

    function stake(Bounty bounty, uint amountWei) external onlyBroker {
        require(IFactory(globalData().streamrConstants.bountyFactory()).deploymentTimestamp(address(bounty)) > 0, "error_badBounty");
        require(queueIsEmpty(), "error_mustPayOutExitQueueBeforeStaking");
        globalData().token.approve(address(bounty), amountWei);
        if (indexOfBounties[bounty] == 0) {
            bounty.stake(address(this), amountWei); // may fail if amountWei < MinimumStakeJoinPolicy.minimumStake
            bounties.push(bounty);
            indexOfBounties[bounty] = bounties.length; // real array index + 1
            approxPoolValueOfBounty[bounty] += amountWei;
            bounty.registerAsSlashListener();
        }
        emit Staked(bounty, amountWei);
    }

    /**
     *
     */
    function unstake(Bounty bounty, uint maxPayoutCount) external onlyBroker {
        _unstake(bounty);
        payOutQueueWithFreeFunds(maxPayoutCount);
    }

    function _unstake(Bounty bounty) private {
        // console.log("## unstakeWithoutQueue bounty", address(bounty));
        uint amountStaked = bounty.getMyStake();
        require(amountStaked > 0, "error_notStaked");
        uint balanceBefore = globalData().token.balanceOf(address(this));
        // console.log("unstake balanceBefore", balanceBefore);
        bounty.leave();
        uint receivedWei = globalData().token.balanceOf(address(this)) - balanceBefore;
        globalData().approxPoolValue -= approxPoolValueOfBounty[bounty];
        // console.log("bounties approx pool value", approxPoolValueOfBounty[bounty]);
        // console.log("unstake receivedWei", receivedWei);
        globalData().approxPoolValue += receivedWei;
        // console.log("unstake new approxPoolValue", globalData().approxPoolValue);
        approxPoolValueOfBounty[bounty] = 0;

        // unallocatedWei += receivedWei;
        if (receivedWei < amountStaked) {
            // TODO: slash handling
            uint lossesWei = amountStaked - receivedWei;
            emit Unstaked(bounty, receivedWei, 0);
            emit Losses(bounty, lossesWei);
        } else {
            // TODO: gains handling
            uint gainsWei = receivedWei - amountStaked;
            moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector, gainsWei),
                "error_yieldPolicy_deductBrokersPart_Failed");
            emit Unstaked(bounty, amountStaked, gainsWei);
        }

        bounty.unregisterAsSlashListener();

        // remove from array: replace with the last element
        uint index = indexOfBounties[bounty] - 1; // indexOfBounties is the real array index + 1
        Bounty lastBounty = bounties[bounties.length - 1];
        bounties[index] = lastBounty;
        bounties.pop();
        indexOfBounties[lastBounty] = index + 1; // indexOfBounties is the real array index + 1
        delete indexOfBounties[bounty];
    }

    function reduceStake(Bounty bounty, uint amountWei) external onlyBroker {
        // console.log("## reduceStake amountWei", amountWei);
        _reduceStakeWithoutQueue(bounty, amountWei);
        payOutQueueWithFreeFunds(0);
    }

    function _reduceStakeWithoutQueue(Bounty bounty, uint amountWei) public onlyBroker {
        // console.log("## _reduceStakeWithoutQueue amountWei", amountWei);
        // console.log("reduceStake balanceOf this", globalData().token.balanceOf(address(this)));
        uint amountStaked = bounty.getMyStake();
        require(amountStaked > 0, "error_notStaked");
        require(amountWei <= amountStaked, "error_notEnoughStaked");
        uint balanceBefore = globalData().token.balanceOf(address(this));
        // console.log("reduceStake balanceBefore", balanceBefore);
        bounty.reduceStake(amountWei);
        uint receivedWei = globalData().token.balanceOf(address(this)) - balanceBefore;
        globalData().approxPoolValue -= amountWei;
        globalData().approxPoolValue += receivedWei;
        approxPoolValueOfBounty[bounty] -= amountWei;
        // console.log("reduceStake receivedWei", receivedWei);
        // unallocatedWei += receivedWei;
        if (receivedWei < amountStaked) {
            // TODO: slash handling
            uint lossesWei = amountStaked - receivedWei;
            emit Unstaked(bounty, receivedWei, 0);
            emit Losses(bounty, lossesWei);
        }
    }

    function withdrawWinningsFromBounty(Bounty bounty) external onlyBroker {
        // console.log("## withdrawWinningsFromBounty");
        updateApproximatePoolvalueOfBounty(bounty);
        _withdrawWinningsFromBountyWithoutQueue(bounty);
        payOutQueueWithFreeFunds(0);
    }

    function _withdrawWinningsFromBountyWithoutQueue(Bounty bounty) public onlyBroker {
        // console.log("## withdrawWinnings bounty", address(bounty));
        // require(staked[bounty] > 0, "error_notStaked");
        uint balanceBefore = globalData().token.balanceOf(address(this));
        // console.log("withdrawWinnings balanceBefore", balanceBefore);
        bounty.withdraw();
        // console.log("withdrawWinnings balanceAfter", globalData().token.balanceOf(address(this)));
        uint winnings = globalData().token.balanceOf(address(this)) - balanceBefore;
        // console.log("withdrawWinnings winnings", winnings);
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector, winnings),
            "error_yieldPolicy_deductBrokersPart_Failed");

        // value left in bounty === stake, after the allocations have been withdrawn
        // globalData().approxPoolValue however should NOT change, because winnings are simply moved from bounty to this contract
        //   minus broker's share (which is deducted during approxPoolValue calculation anyway, see `getPoolValueFromBounty`)
        approxPoolValueOfBounty[bounty] = bounty.getMyStake();
    }

    function queueIsEmpty() public view returns (bool) {
        return queuePayoutIndex == queueLength;
    }

    // TODO: instead of special-casing maxIterations zero, call with a large value
    function payOutQueueWithFreeFunds(uint maxIterations) public {
        if (maxIterations == 0) { maxIterations = 1 ether; } // see TODO above
        for (uint i = 0; i < maxIterations; i++) {
            uint balanceDataWei = globalData().token.balanceOf(address(this));
            if (balanceDataWei == 0 || queueIsEmpty()) {
                break;
            }

            // take the first element from the queue, and silently cap it to the amount of pool tokens the exiting delegator has
            address user = payoutQueue[queuePayoutIndex].user;
            uint amountPoolTokens = payoutQueue[queuePayoutIndex].amountPoolTokenWei;
            if (balanceOf(user) < amountPoolTokens) {
                amountPoolTokens = balanceOf(user);
            }
            if (amountPoolTokens == 0) {
                // nothing to pay => pop the item
                delete payoutQueue[queuePayoutIndex];
                queuePayoutIndex++;
                continue;
            }

            // console.log("payOutQueueWithFreeFunds amountPoolTokens", amountPoolTokens);
            uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
                amountPoolTokens, 0), "error_yieldPolicy_pooltokenToData_Failed");
            if (balanceDataWei >= amountDataWei) {
                // whole amountDataWei is paid out => pop the item and swap tokens
                delete payoutQueue[queuePayoutIndex];
                queuePayoutIndex++;
                queuedPayoutsPerUser[user] -= amountPoolTokens;
                _burn(user, amountPoolTokens);
                globalData().token.transfer(user, amountDataWei);
                globalData().approxPoolValue -= amountDataWei;
                emit InvestmentReturned(user, amountDataWei);
            } else {
                // whole pool's balance is paid out as a partial payment, update the item in the queue
                uint256 partialAmountPoolTokens = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
                    balanceDataWei, 0), "error_yieldPolicy_dataToPooltoken_Failed");
                queuedPayoutsPerUser[user] -= partialAmountPoolTokens;
                PayoutQueueEntry memory oldEntry = payoutQueue[queuePayoutIndex];
                uint256 poolTokensLeftInQueue = oldEntry.amountPoolTokenWei - partialAmountPoolTokens;
                payoutQueue[queuePayoutIndex] = PayoutQueueEntry(oldEntry.user, poolTokensLeftInQueue, oldEntry.timestamp);
                _burn(user, partialAmountPoolTokens);
                globalData().token.transfer(user, balanceDataWei);
                globalData().approxPoolValue -= balanceDataWei;
                emit InvestmentReturned(user, balanceDataWei);
                emit QueueUpdated(user, poolTokensLeftInQueue);
            }
        }
    }

    function getMyQueuedPayoutPoolTokens() public view returns (uint256 amountDataWei) {
        return queuedPayoutsPerUser[_msgSender()];
    }

    function getMyBalanceInData() public view returns (uint256 amountDataWei) {
        // console.log("## getMyBalanceInData");
        uint poolTokenBalance = balanceOf(_msgSender());
        (uint dataWei) = moduleGet(abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector, poolTokenBalance, 0, address(yieldPolicy)), "error_pooltokenToData_Failed");
        // console.log("getMyBalanceInData dataWei", dataWei);
        return dataWei;
    }

    /**
     * @dev Don't call from smart contract, could be expensive
     */
    function calculatePoolValueInData() public view returns (uint256 poolValue) {
        poolValue = globalData().token.balanceOf(address(this));
        for (uint i = 0; i < bounties.length; i++) {
            poolValue += getPoolValueFromBounty(bounties[i]);
        }
    }

    // TODO: exit(uint amountPoolTokenWei) public
    function queueDataPayout(uint amountPoolTokenWei) public {
        // console.log("## queueDataPayout");
        queueDataPayoutWithoutQueue(amountPoolTokenWei);
        payOutQueueWithFreeFunds(0);
    }

    // function queue(uint amountPoolTokenWei), should be internal? We don't maybe want to allow just spamming the queue...
    function queueDataPayoutWithoutQueue(uint amountPoolTokenWei) public {
        // console.log("## queueDataPayoutWithoutQueue");
        require(amountPoolTokenWei > 0, "error_payout_amount_zero");
        // require(balanceOf(_msgSender()) >= amountPoolTokenWei, "error_noEnoughPoolTokens");
        // console.log("queueDataPayout amountPoolTokenWei", amountPoolTokenWei);
        // _transfer(_msgSender(), address(this), amountPoolTokenWei);
        // uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
        //     amountPoolTokenWei), "error_yieldPolicy_pooltokenToData_Failed");
        // _burn(_msgSender(), amountPoolTokenWei);
        queuedPayoutsPerUser[_msgSender()] += amountPoolTokenWei;
        payoutQueue[queueLength] = PayoutQueueEntry(_msgSender(), amountPoolTokenWei, block.timestamp);
        queueLength++;
        emit QueuedDataPayout(_msgSender(), amountPoolTokenWei);
    }

    /**
     * Broker hasn't been doing its job, queue hasn't been paid out
     * Anyone can come along and force unstaking a bounty to get pay-outs rolling
     * @param bounty the funds (unstake) to pay out the queue
     * @param maxIterations how many queue items to pay out
     */
    function forceUnstake(Bounty bounty, uint maxIterations) external {
        require(payoutQueue[queuePayoutIndex].timestamp + gracePeriodSeconds < block.timestamp, "error_gracePeriod");

        // updateApproximatePoolvalueOfBounty(bounty);
        // console.log("## forceUnstake");
        _unstake(bounty);
        payOutQueueWithFreeFunds(maxIterations);
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }

    function onSlash() external override {
        // console.log("## onSlash");
        // TODO: check msg.sender is a bounty
        updateApproximatePoolvalueOfBounty(Bounty(msg.sender));
    }

    ////////////////////////////////////////
    // POLICY MODULE MANAGEMENT
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

    ////////////////////////////////////////
    // POOL VALUE UPDATING + incentivization
    ////////////////////////////////////////

    /**
     * The broker is supposed to keep the approximate pool value up to date by calling updateApproximatePoolvalueOfBounty
     *   on the bounties that have generated most winnings = discrepancy between the approximate and the real pool value.
     */
    function updateApproximatePoolvalueOfBounty(Bounty bounty) public {
        uint actual = getPoolValueFromBounty(bounty);
        uint approx = approxPoolValueOfBounty[bounty];
        approxPoolValueOfBounty[bounty] = actual;
        globalData().approxPoolValue = globalData().approxPoolValue + actual - approx;
    }

    function getPoolValueFromBounty(Bounty bounty) public view returns (uint256 poolValue) {
        uint alloc = bounty.getAllocation(address(this));
        uint share = moduleGet(abi.encodeWithSelector(yieldPolicy.calculateBrokersShare.selector, alloc, address(yieldPolicy)), "error_calculateBrokersShare_Failed");
        poolValue = bounty.getMyStake() + alloc - share;
    }

    /**
     * Convenience method to get all (approximate) bounty values
     * The broker needs to keep an eye on the approximate values at all times, so that the approximation is not too far off.
     * If someone else notices that the approximation is too far off, they can call updateApproximatePoolvalueOfBounties to get a small prize (paid from broker's pool tokens)
     * @dev this is not meant to be called from a smart contract, could be expensive
     **/
    function getApproximatePoolValuesPerBounty() external view returns (
        address[] memory bountyAdresses,
        uint[] memory approxValues,
        uint[] memory realValues
    ) {
        bountyAdresses = new address[](bounties.length);
        approxValues = new uint[](bounties.length);
        realValues = new uint[](bounties.length);
        for (uint i = 0; i < bounties.length; i++) {
            bountyAdresses[i] = address(bounties[i]);
            approxValues[i] = approxPoolValueOfBounty[bounties[i]];
            realValues[i] = getPoolValueFromBounty(bounties[i]);
        }
    }

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
        globalData().approxPoolValue = globalData().approxPoolValue + sumActual - sumApprox;

        // if total difference is more than allowed, then slash the broker a bit
        uint allowedDifference = globalData().approxPoolValue * globalData().streamrConstants.PERCENT_DIFF_APPROX_POOL_VALUE() / 100;
        if (sumActual > sumApprox + allowedDifference) {
            _transfer(globalData().broker, _msgSender(),
                balanceOf(globalData().broker) * globalData().streamrConstants.PUNISH_BROKERS_PT_THOUSANDTH() / 1000);
        }
    }
}
