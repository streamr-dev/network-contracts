// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

import "../IERC677.sol";
import "../IERC677Receiver.sol";

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../Bounties/Bounty.sol";
import "./policies/IPoolJoinPolicy.sol";
import "./policies/IPoolYieldPolicy.sol";
import "./policies/IPoolExitPolicy.sol";

import "hardhat/console.sol";

/**
 * Broker Pool receives a delegators' investments and pays out yields
 * It also is an ERC20 token for the pool tokens
 */
contract BrokerPool is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable, ERC20Upgradeable { //}, ERC2771Context {

    event InvestmentReceived(address indexed investor, uint amountWei);
    event InvestmentReturned(address indexed investor, uint amountWei);
    event Staked(Bounty indexed bounty, uint amountWei);
    event Losses(Bounty indexed bounty, uint amountWei);
    event Unstaked(Bounty indexed bounty, uint stakeWei, uint gainsWei);
    event QueuedDataPayout(address user, uint amountDataWei);
    event UnqueuedDataPayout(address user, uint amountDataWei);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    uint public minimumInvestmentWei;
    uint public gracePeriodSeconds;
    uint constant MAX_SLASH_TIME = 30 days;
    IPoolJoinPolicy public joinPolicy;
    IPoolYieldPolicy public yieldPolicy;
    IPoolExitPolicy public exitPolicy;

    struct GlobalStorage {
        address broker;  
        IERC677 token;
        uint approxPoolValue; // in Data wei
    }

    // currently the whole token balance of the pool IS SAME AS the "free funds"
    //   so there's no need to track the unallocated tokens separately
    // uint public unallocatedWei;

    // mapping(address => uint) public debt;
    // mapping(Bounty => uint) public staked;
    Bounty[] public bounties;
    mapping(Bounty => uint) public indexOfBounties; // start with 1! use 0 as "is it already in the array?" check

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
    // 1. rea actual poolvalue val = local free funds + stake in bounties + allocaiotn in bounties; loops over bounties
    // 2. val = Sum over local mapping approxPoolValueOfBounty + free funds
    // 3. val = approxPoolValue in globalstorage
    mapping(Bounty => uint) public approxPoolValueOfBounty; // in Data wei

    modifier onlyBroker() {
        require(msg.sender == globalData().broker, "error_only_broker");
        _;
    }
    modifier onlyBrokerOrForced() {
        require(msg.sender == globalData().broker || payoutQueue[queuePayoutIndex].timestamp + MAX_SLASH_TIME < block.timestamp, "error_only_broker_or_forced") ;
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}


    function initialize(
        address tokenAddress,
        address brokerAddress,
        string calldata poolName,
        uint initialMinimumInvestmentWei,
        uint gracePeriodSeconds_
    ) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // _setupRole(ADMIN_ROLE, newOwner);
        // _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE); // admins can make others admin, too
        globalData().token = IERC677(tokenAddress);
        globalData().broker = brokerAddress;
        minimumInvestmentWei = initialMinimumInvestmentWei;
        ERC20Upgradeable.__ERC20_init(poolName, poolName);
        require(gracePeriodSeconds_ >= MAX_SLASH_TIME, "error_gracePeriodTooShort");
        gracePeriodSeconds = gracePeriodSeconds_;
    }

    function setJoinPolicy(IPoolJoinPolicy policy, uint256 initialMargin, uint256 minimumMarginPercent) public {
        joinPolicy = policy;
        moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.setParam.selector, initialMargin, minimumMarginPercent), "error_setJoinPolicyFailed");
    }

    function setYieldPolicy(IPoolYieldPolicy policy,
        uint256 initialMargin,
        uint256 maintenanceMarginPercent,
        uint256 minimumMarginPercent,
        uint256 brokerSharePercent,
        uint256 brokerShareMaxDivertPercent) public {
        yieldPolicy = policy;
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.setParam.selector, 
            initialMargin, maintenanceMarginPercent, minimumMarginPercent, brokerSharePercent, 
            brokerShareMaxDivertPercent), "error_setYieldPolicyFailed");
    }

    function setExitPolicy(IPoolExitPolicy policy, uint param) public {
        exitPolicy = policy;
        moduleCall(address(exitPolicy), abi.encodeWithSelector(exitPolicy.setParam.selector, param), "error_setExitPolicyFailed");
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

    function getApproximatePoolValuesPerBounty() external view returns (address[] memory bountyAdresses, 
    uint[] memory approxValues, uint[] memory realValues) {
        approxValues = new uint[](bounties.length);
        bountyAdresses = new address[](bounties.length);
        realValues = new uint[](bounties.length);
        for (uint i = 0; i < bounties.length; i++) {
            approxValues[i] = approxPoolValueOfBounty[bounties[i]];
            bountyAdresses[i] = address(bounties[i]);
            realValues[i] = getPoolValueFromBounty(bounties[i]);
        }
    }

    function getApproximatePoolValue() external view returns (uint) {
        return globalData().approxPoolValue;
    }

    function getBountiesApproximatePoolValue(Bounty bounty) external view returns (uint) {
        return approxPoolValueOfBounty[bounty];
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

        // check if sender is a bounty: only bounties may have tokens _staked_ on them
        // TODO check if bounty was deployed by THE bountyfactory contract!
        

        Bounty bounty = Bounty(sender);
        if (indexOfBounties[bounty] != 0) {
            // ignore returned tokens, handle it in unstake()
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

    function _addBounty(Bounty bounty) internal {
        // console.log("## _addBounty");
        require(indexOfBounties[bounty] == 0, "error_bountyAlreadyExists");
        bounties.push(bounty);
        indexOfBounties[bounty] = bounties.length;
    }

    function _removeBounty(Bounty bounty) internal {
        // console.log("## _removeBounty");
        require(indexOfBounties[bounty] != 0, "error_bountyDoesNotExist");
        uint index = indexOfBounties[bounty];
        indexOfBounties[bounty] = 0;
        bounties[index - 1] = bounties[bounties.length - 1];
        indexOfBounties[bounties[index - 1]] = index;
        bounties.pop();
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
            (uint allowed) = moduleGet(abi.encodeWithSelector(joinPolicy.canJoin.selector, investor, address(joinPolicy)), "error_joinPolicyFailed");
            // console.log("_invest allowed", allowed);
            require(allowed == 1, "error_joinPolicyFailed");
        }
        // uint256 amountPoolToken = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
        //     amountWei), "error_yieldPolicy_dataToPooltoken_Failed");
        uint256 amountPoolToken = dataToPooltokenBeforeTransfer(amountWei);
        _mint(investor, amountPoolToken);
        // console.log("minting", amountPoolToken, "to", investor);
        emit InvestmentReceived(investor, amountWei);
    }

     function dataToPooltokenBeforeTransfer(uint256 dataWei) public view returns (uint256 poolTokenWei) {
        // console.log("## dataToPooltokenBeforeTransfer", dataWei);
        if (this.totalSupply() == 0) {
            // console.log("total supply is 0");
            return dataWei;
        }
        // console.log("DefaultPoolYieldPolicy.dataToPooltoken", dataWei);
        // console.log("data balance of this", globalData().token.balanceOf(address(this)));
        // uint poolValueData = this.calculatePoolValueInData(dataWei);
        uint poolValueData = globalData().approxPoolValue - dataWei;
        // console.log("this totlasupply", this.totalSupply());
        // console.log("poolValueData", poolValueData);
        if (poolValueData == 0) {
            return dataWei;
        }
        return dataWei * this.totalSupply() / poolValueData;
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
        // require(unallocatedWei >= amountWei, "error_notEnoughFreeFunds");
        // console.log("## stake amountWei", amountWei);
        // console.log("stake balanceOf this", globalData().token.balanceOf(address(this)));
        globalData().token.approve(address(bounty), amountWei);
        bounty.stake(address(this), amountWei); // may fail if amountWei < MinimumStakeJoinPolicy.minimumStake
        _addBounty(bounty);
        // unallocatedWei -= amountWei;
        approxPoolValueOfBounty[bounty] += amountWei;
        emit Staked(bounty, amountWei);
    }

    function unstake(Bounty bounty) external onlyBroker { // remove modifier, double checked..?
        unstakeWithoutQueue(bounty);
        payOutQueueWithFreeFunds(0);
    }

    function unstakeWithoutQueue(Bounty bounty) public onlyBrokerOrForced {
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
            // // TODO: gains handling
            // uint gainsWei = receivedWei - amountStaked;
            uint winnings = receivedWei - amountStaked;
            moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector,
                winnings), "error_yieldPolicy_deductBrokersPart_Failed");
            emit Unstaked(bounty, amountStaked, winnings);
        }
        _removeBounty(bounty);
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
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector,
            winnings), "error_yieldPolicy_deductBrokersPart_Failed");
        
        // uint appoxWinnings = approxPoolValueOfBounty[bounty] - bounty.getMyStake();
        // uint approxWinningsLeft = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector,
        //     appoxWinnings), "error_yieldPolicy_deductBrokersPart_Failed");
        // int difference = int(approxWinningsLeft) - int(winningsLeft);
        // if (difference > 0) {
        //     globalData().approxPoolValue += uint(difference);
        // } else {
        //     globalData().approxPoolValue -= uint(-difference);
        // }
    }

    function payOutQueueWithFreeFunds(uint maxIterations) public {
        // console.log("## payOutQueueWithFreeFunds called queueLength", queueLength);
        // logging out queue
        // uint i = queuePayoutIndex;
        // while (i <= queueLength) {
        //     // console.log("# queuePrint", i, payoutQueue[i].user, payoutQueue[i].amountPoolTokenWei);
        //     i++;
        // }
        uint currentExchangeRate = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
                1e18, 0), "error_yieldPolicy_pooltokenToData_Failed");
        uint iteration = 0;
        while (globalData().token.balanceOf(address(this)) > 0 && queueLength - queuePayoutIndex > 0
            && (maxIterations == 0 || iteration < maxIterations)) {
            iteration++;
            // console.log("payOutQueueWithFreeFunds queuePayoutIndex", queuePayoutIndex);
            uint amountPoolTokens = payoutQueue[queuePayoutIndex].amountPoolTokenWei;
            address user = payoutQueue[queuePayoutIndex].user;
            // console.log("payOutQueueWithFreeFunds amountPoolTokens", amountPoolTokens);
            // uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            //     amountPoolTokens, 0), "error_yieldPolicy_pooltokenToData_Failed");
            uint256 amountDataWei = amountPoolTokens * currentExchangeRate / 1e18;
            // uint256 amountDataWei = 1000000000000000000;
            // console.log("payOutQueueWithFreeFunds amountDataWei", amountDataWei);
            // console.log("payOutQueueWithFreeFunds balanceBefore", globalData().token.balanceOf(address(this)));
            if (globalData().token.balanceOf(address(this)) >= amountDataWei) {
                // whole amountDataWei is paid out
                // console.log("payOutQueueWithFreeFunds whole amountDataWei");
                queuedPayoutsPerUser[user] -= amountPoolTokens;
                queuePayoutIndex++;
                _burn(address(this), amountPoolTokens);
                globalData().token.transfer(user, amountDataWei);
                globalData().approxPoolValue -= amountDataWei;
                emit InvestmentReturned(user, amountDataWei);
            } else {
                // partial amountDataWei is paid out
                // TODO make shorter, optimize memory usage
                uint256 partialAmountDataWei = globalData().token.balanceOf(address(this));
                // console.log("payOutQueueWithFreeFunds partialAmountDataWei", partialAmountDataWei);
                // uint256 remainingAmountDataWei = amountDataWei - partialAmountDataWei;
                uint256 partialAmountPoolTokens = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
                    partialAmountDataWei, 0), "error_yieldPolicy_dataToPooltoken_Failed");
                queuedPayoutsPerUser[user] -= partialAmountPoolTokens;
                PayoutQueueEntry memory oldEntry = payoutQueue[queuePayoutIndex];
                payoutQueue[queuePayoutIndex] = PayoutQueueEntry(oldEntry.user, oldEntry.amountPoolTokenWei - partialAmountPoolTokens, oldEntry.timestamp);
                _burn(address(this), partialAmountPoolTokens);
                globalData().token.transfer(user, partialAmountDataWei);
                globalData().approxPoolValue -= partialAmountDataWei;
                emit InvestmentReturned(user, partialAmountDataWei);
            }
        }
    }

    function getQueuedPayoutPoolTokens() public view returns (uint256 amountDataWei) {
        // console.log("## getQueuedPayoutPoolTokens");
        return queuedPayoutsPerUser[_msgSender()];
    }

    function getMyBalanceInData() public view returns (uint256 amountDataWei) {
        // console.log("## getMyBalanceInData");
        uint poolTokenBalance = balanceOf(_msgSender());
        (uint dataWei) = moduleGet(abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector, poolTokenBalance, 0, address(yieldPolicy)), "error_pooltokenToData_Failed");
        // console.log("getMyBalanceInData dataWei", dataWei);
        return dataWei;
    }

    function calculatePoolValueInData(uint256 substractWei) public view returns (uint256 poolValue) {
        // console.log("## calculatePoolValueInData");
        poolValue = globalData().token.balanceOf(address(this));
        // console.log("calculatePoolValueInData poolValue1", poolValue);
        for (uint i = 0; i < bounties.length; i++) {
            poolValue += getPoolValueFromBounty(bounties[i]);
            // console.log("calculatePoolValueInData poolValue of bounty", poolValue);
        }
        poolValue -= substractWei;
    }

    function getPoolValueFromBounty(Bounty bounty) public view returns (uint256 poolValue) {
        // console.log("## getPoolValueFromBounty");
        poolValue += bounty.getMyStake();
        // console.log("calculatePoolValueInData poolValue2", poolValue);
        uint alloc = bounty.getAllocation(address(this));
        // console.log("calculatePoolValueInData alloc", alloc);
        (uint share) = moduleGet(abi.encodeWithSelector(yieldPolicy.calculateBrokersShare.selector, alloc, address(yieldPolicy)), "error_calculateBrokersShare_Failed");
        // console.log("calculatePoolValueInData share", share);
        poolValue += (alloc - share);
    }

    function updateApproximatePoolvalueOfBounties(Bounty[] memory bountyAddresses) public {
        int sum = 0;
        uint PERCENT_OF_APPROX_POOL_VALUE = 10; // move to global constants contract
        uint PUNISH_BROKERS_PT_THOUSANDTH = 5; // move to global constants contract
        for (uint i = 0; i < bountyAddresses.length; i++) {
            int diff = updateApproximatePoolvalueOfBounty(bountyAddresses[i]);
            sum += diff;
        }
        // if uint of sum is more than 10% of approxPoolValue, then log it
        if (uint(sum) > globalData().approxPoolValue * PERCENT_OF_APPROX_POOL_VALUE / 100) {
            _transfer(globalData().broker, _msgSender(), 
                balanceOf(globalData().broker) * PUNISH_BROKERS_PT_THOUSANDTH / 1000);
        }
    }

    function updateApproximatePoolvalueOfBounty(Bounty bounty) public returns (int diff){
        // console.log("## updateApproximatePoolvalueOfBounty");
        uint approximatePoolValueOfBounty = approxPoolValueOfBounty[bounty];
        uint realPoolValueOfBounty = getPoolValueFromBounty(bounty);
        if (approximatePoolValueOfBounty < realPoolValueOfBounty) {
            uint difference = realPoolValueOfBounty - approximatePoolValueOfBounty;
            approxPoolValueOfBounty[bounty] += difference;
            globalData().approxPoolValue += difference;
            diff = int(difference);
        } else {
            uint difference = approximatePoolValueOfBounty - realPoolValueOfBounty;
            approxPoolValueOfBounty[bounty] -= difference;
            globalData().approxPoolValue -= difference;
            diff = -int(difference);
        }
    }

    function queueDataPayout(uint amountPoolTokenWei) public {
        // console.log("## queueDataPayout");
        queueDataPayoutWithoutQueue(amountPoolTokenWei);
        payOutQueueWithFreeFunds(0);
    }

    function queueDataPayoutWithoutQueue(uint amountPoolTokenWei) public {
        // console.log("## queueDataPayoutWithoutQueue");
        require(amountPoolTokenWei > 0, "error_payout_amount_zero");
        // require(balanceOf(_msgSender()) >= amountPoolTokenWei, "error_noEnoughPoolTokens");
        // console.log("queueDataPayout amountPoolTokenWei", amountPoolTokenWei);
        _transfer(_msgSender(), address(this), amountPoolTokenWei);
        // uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
        //     amountPoolTokenWei), "error_yieldPolicy_pooltokenToData_Failed");
        // _burn(_msgSender(), amountPoolTokenWei);
        queuedPayoutsPerUser[_msgSender()] += amountPoolTokenWei;
        payoutQueue[queueLength] = PayoutQueueEntry(_msgSender(), amountPoolTokenWei, block.timestamp);
        queueLength++;
        emit QueuedDataPayout(_msgSender(), amountPoolTokenWei);
    }

    function forceUnstake(Bounty bounty) external {
        // updateApproximatePoolvalueOfBounty(bounty);
        // console.log("## forceUnstake");
        unstakeWithoutQueue(bounty);
        payOutQueueWithFreeFunds(0);
    }

     /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }
}
