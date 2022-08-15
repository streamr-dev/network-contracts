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

    uint public minimumInvestmentWei;
    IPoolJoinPolicy public joinPolicy;
    IPoolYieldPolicy public yieldPolicy;
    IPoolExitPolicy public exitPolicy;

    struct GlobalStorage {
        address broker;  
        IERC677 token;
    }

    // currently the whole token balance of the pool IS SAME AS the "free funds"
    //   so there's no need to track the unallocated tokens separately
    // uint public unallocatedWei;

    mapping(address => uint) public debt;
    // mapping(Bounty => uint) public staked;
    Bounty[] public bounties;
    mapping(Bounty => uint) public indexOfBounties; // start with 1! use 0 as "is it already in the array?" check

    struct PayoutQueueEntry {
        address user;
        uint amountPoolTokenWei;
    }
    mapping(uint => PayoutQueueEntry) public payoutQueue;
    // answers 'how much do i have queued in total to be paid out'
    mapping(address => uint) public queuedPayoutsPerUser;
    uint public queueLength;
    uint public queuePayoutIndex;

    modifier onlyBroker() {
        require(msg.sender == globalData().broker, "error_only_broker");
        _;
    }

    function initialize(
        address tokenAddress,
        address brokerAddress,
        string calldata poolName,
        address trustedForwarderAddress,
        uint initialMinimumInvestmentWei
    ) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // _setupRole(ADMIN_ROLE, newOwner);
        // _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE); // admins can make others admin, too
        globalData().token = IERC677(tokenAddress);
        globalData().broker = brokerAddress;
        minimumInvestmentWei = initialMinimumInvestmentWei;
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        ERC20Upgradeable.__ERC20_init(poolName, poolName);
    }

    function setJoinPolicy(IPoolJoinPolicy policy, uint param) public {
        joinPolicy = policy;
        moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.setParam.selector, param), "error_setJoinPolicyFailed");
    }

    function setYieldPolicy(IPoolYieldPolicy policy, uint param) public {
        yieldPolicy = policy;
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.setParam.selector, param), "error_setYieldPolicyFailed");
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
        // console.log("onTokenTransfer from", sender);
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
        require(indexOfBounties[bounty] == 0, "error_bountyAlreadyExists");
        bounties.push(bounty);
        indexOfBounties[bounty] = bounties.length;
    }

    function _removeBounty(Bounty bounty) internal {
        require(indexOfBounties[bounty] != 0, "error_bountyDoesNotExist");
        uint index = indexOfBounties[bounty];
        indexOfBounties[bounty] = 0;
        bounties[index - 1] = bounties[bounties.length - 1];
        indexOfBounties[bounties[index - 1]] = index;
        bounties.pop();
    }

    /** Invest by first calling ERC20.approve(brokerPool.address, amountWei) then this function */
    function invest(uint amountWei) public payable {
        globalData().token.transferFrom(_msgSender(), address(this), amountWei);
        _invest(_msgSender(), amountWei);
    }

    function _invest(address investor, uint amountWei) internal {
        // unallocatedWei += amountWei;
        console.log("_invest investor", investor, "amountWei", amountWei);
        uint256 amountPoolToken = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
            amountWei), "error_yieldPolicy_dataToPooltoken_Failed");

        _mint(investor, amountPoolToken);
        console.log("_invest amountWei", amountWei, "amountPoolToken", amountPoolToken);
        emit InvestmentReceived(investor, amountWei);
    }

    // function withdraw(uint amountPoolTokenWei) public {
    //     // token.transferAndCall(_msgSender(), amountWei, "0x");
    //     console.log("withdraw amountPoolTokenWei", amountPoolTokenWei);
    //     console.log("balance msgSender ", balanceOf(_msgSender()));
    //     uint256 calculatedAmountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
    //         amountPoolTokenWei), "error_yieldPolicyFailed");
    //     console.log("withdraw calculatedAmountDataWei", calculatedAmountDataWei);
    //     _burn(_msgSender(), amountPoolTokenWei);
    //     uint poolDataBalance = globalData().token.balanceOf(address(this));
    //     console.log("withdraw poolDataBalance", poolDataBalance);
    //     if (calculatedAmountDataWei > poolDataBalance) {
    //         queuedPayoutsDataWei[_msgSender()] = calculatedAmountDataWei - poolDataBalance;
    //         console.log("withdraw #", calculatedAmountDataWei - poolDataBalance);
    //         console.log("msgSender", _msgSender(), "queuedPayoutsWei", queuedPayoutsDataWei[_msgSender()]);
    //         calculatedAmountDataWei = poolDataBalance;
    //     }
    //     console.log("withdraw calculatedAmountDataWei", calculatedAmountDataWei);
    //     globalData().token.transfer(_msgSender(), calculatedAmountDataWei);
    //     emit InvestmentReturned(_msgSender(), calculatedAmountDataWei);
    //     // unallocatedWei -= amountWei;
    // }

    /////////////////////////////////////////
    // BROKER FUNCTIONS
    /////////////////////////////////////////

    function stake(Bounty bounty, uint amountWei) external onlyBroker {
        // require(unallocatedWei >= amountWei, "error_notEnoughFreeFunds");
        console.log("stake amountWei", amountWei);
        console.log("stake balanceOf this", globalData().token.balanceOf(address(this)));
        globalData().token.approve(address(bounty), amountWei);
        bounty.stake(address(this), amountWei); // may fail if amountWei < MinimumStakeJoinPolicy.minimumStake
        _addBounty(bounty);
        // unallocatedWei -= amountWei;
        emit Staked(bounty, amountWei);
    }

    function unstake(Bounty bounty) external onlyBroker {
        console.log("unstake bounty", address(bounty));
        uint amountStaked = bounty.getMyStake();
        require(amountStaked > 0, "error_notStaked");
        uint balanceBefore = globalData().token.balanceOf(address(this));
        console.log("unstake balanceBefore", balanceBefore);
        bounty.leave();
        uint receivedWei = globalData().token.balanceOf(address(this)) - balanceBefore;
        console.log("unstake receivedWei", receivedWei);

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

    function withdrawWinningsFromBounty(Bounty bounty) external onlyBroker {
        // require(staked[bounty] > 0, "error_notStaked");
        uint balanceBefore = globalData().token.balanceOf(address(this));
        console.log("withdrawWinnings balanceBefore", balanceBefore);
        bounty.withdraw();
        console.log("withdrawWinnings balanceAfter", globalData().token.balanceOf(address(this)));
        uint winnings = globalData().token.balanceOf(address(this)) - balanceBefore;
        console.log("withdrawWinnings winnings", winnings);
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector,
            winnings), "error_yieldPolicy_deductBrokersPart_Failed");
        payOutQueueWithFreeFunds();
    }

    function payOutQueueWithFreeFunds() internal {
        // logging out queue
        uint i = queuePayoutIndex;
        while (i <= queueLength) {
            console.log("# queuePrint", i, payoutQueue[i].user, payoutQueue[i].amountPoolTokenWei);
            i++;
        }

        while (globalData().token.balanceOf(address(this)) > 0 && queueLength - queuePayoutIndex > 0) {
            uint amountPoolTokens = payoutQueue[queuePayoutIndex].amountPoolTokenWei;
            address user = payoutQueue[queuePayoutIndex].user;
            console.log("payOutQueueWithFreeFunds amountPoolTokens", amountPoolTokens);
            uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
                amountPoolTokens), "error_yieldPolicy_pooltokenToData_Failed");
            console.log("payOutQueueWithFreeFunds amountDataWei", amountDataWei);
            console.log("payOutQueueWithFreeFunds balanceBefore", globalData().token.balanceOf(address(this)));
            if (globalData().token.balanceOf(address(this)) >= amountDataWei) {
                // whole amountDataWei is paid out
                console.log("payOutQueueWithFreeFunds whole amountDataWei");
                queuedPayoutsPerUser[user] -= amountPoolTokens;
                queuePayoutIndex++;
                globalData().token.transfer(user, amountDataWei);
                emit InvestmentReturned(user, amountDataWei);
            } else {
                // partial amountDataWei is paid out
                // TODO make shorter, optimize memory usage
                uint256 partialAmountDataWei = globalData().token.balanceOf(address(this));
                console.log("payOutQueueWithFreeFunds partialAmountDataWei", partialAmountDataWei);
                // uint256 remainingAmountDataWei = amountDataWei - partialAmountDataWei;
                uint256 partialAmountPoolTokens = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
                    partialAmountDataWei), "error_yieldPolicy_dataToPooltoken_Failed");
                queuedPayoutsPerUser[user] -= partialAmountPoolTokens;
                PayoutQueueEntry memory oldEntry = payoutQueue[queuePayoutIndex];
                payoutQueue[queuePayoutIndex] = PayoutQueueEntry(oldEntry.user, oldEntry.amountPoolTokenWei - partialAmountPoolTokens);
                _burn(address(this), partialAmountPoolTokens);
                globalData().token.transfer(user, partialAmountDataWei);
                emit InvestmentReturned(user, partialAmountDataWei);
            }
        }
    }

    function getQueuedPayoutPoolTokens() public view returns (uint256 amountDataWei) {
        return queuedPayoutsPerUser[_msgSender()];
    }

    function getMyBalanceInData() public view returns (uint256 amountDataWei) {
        uint poolTokenBalance = balanceOf(_msgSender());
        return moduleGet(abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector, poolTokenBalance), "error_pooltokenToData_Failed");
    }

    function calculatePoolValueInData() public view returns (uint256 poolValue) {
        poolValue = globalData().token.balanceOf(address(this));
        console.log("calculatePoolValueInData poolValue1", poolValue);
        for (uint i = 0; i < bounties.length; i++) {
            poolValue += bounties[i].getMyStake();
            console.log("calculatePoolValueInData poolValue2", poolValue);
            uint alloc = bounties[i].getAllocation(address(this));
            console.log("calculatePoolValueInData alloc", alloc);
            (uint share) = moduleGet(abi.encodeWithSelector(yieldPolicy.calculateBrokersShare.selector, alloc, address(yieldPolicy)), "error_calculateBrokersShare_Failed");
            console.log("calculatePoolValueInData share", share);
            poolValue += (alloc - share);
        }
    }

    function queueDataPayout(uint amountPoolTokenWei) external {
        require(amountPoolTokenWei > 0, "error_payout_amount_zero");
        // require(balanceOf(_msgSender()) >= amountPoolTokenWei, "error_noEnoughPoolTokens");
        console.log("queueDataPayout amountPoolTokenWei", amountPoolTokenWei);
        _transfer(_msgSender(), address(this), amountPoolTokenWei);
        // uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
        //     amountPoolTokenWei), "error_yieldPolicy_pooltokenToData_Failed");
        // _burn(_msgSender(), amountPoolTokenWei);
        queuedPayoutsPerUser[_msgSender()] += amountPoolTokenWei;
        payoutQueue[queueLength] = PayoutQueueEntry(_msgSender(), amountPoolTokenWei);
        queueLength++;
        payOutQueueWithFreeFunds();
        emit QueuedDataPayout(_msgSender(), amountPoolTokenWei);
    }

    // function unqueueDataPayout(uint amountDataWei) external {
    //     require(amountDataWei > 0, "error_payout_amount_zero");
    //     require(queuedPayoutsDataWei[_msgSender()] >= amountDataWei, "error_notEnoughData");
    //     queuedPayoutsDataWei[_msgSender()] -= amountDataWei;
    //     _mint(_msgSender(), amountDataWei);
    //     emit UnqueuedDataPayout(_msgSender(), amountDataWei);
    // }
}
