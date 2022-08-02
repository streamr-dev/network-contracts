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

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint public minimumInvestmentWei;
    IPoolJoinPolicy public joinPolicy;
    IPoolYieldPolicy public yieldPolicy;
    IPoolExitPolicy public exitPolicy;

    struct GlobalStorage {
        address broker;  
        IERC677 token;
        uint totalStakedWei;
    }

    // currently the whole token balance of the pool IS SAME AS the "free funds"
    //   so there's no need to track the unallocated tokens separately
    // uint public unallocatedWei;

    mapping(address => uint) public debt;
    mapping(Bounty => uint) public staked;

    mapping(uint => address) public payoutQueue;
    mapping(address => uint) public queuedPayoutsDataWei;
    uint public queuedPayoutsCount;
    uint public payoutIndex;
    // mapping(address => uint) public earnings;

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
        if (staked[bounty] > 0) {
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

    function withdraw(uint amountPoolTokenWei) public {
        // token.transferAndCall(_msgSender(), amountWei, "0x");
        console.log("withdraw amountPoolTokenWei", amountPoolTokenWei);
        console.log("balance msgSender ", balanceOf(_msgSender()));
        uint256 calculatedAmountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            amountPoolTokenWei), "error_yieldPolicyFailed");
        console.log("withdraw calculatedAmountDataWei", calculatedAmountDataWei);
        _burn(_msgSender(), amountPoolTokenWei);
        uint poolDataBalance = globalData().token.balanceOf(address(this));
        console.log("withdraw poolDataBalance", poolDataBalance);
        if (calculatedAmountDataWei > poolDataBalance) {
            queuedPayoutsWei[_msgSender()] = calculatedAmountDataWei - poolDataBalance;
            console.log("withdraw #", calculatedAmountDataWei - poolDataBalance);
            console.log("msgSender", _msgSender(), "queuedPayoutsWei", queuedPayoutsWei[_msgSender()]);
            calculatedAmountDataWei = poolDataBalance;
        }
        console.log("withdraw calculatedAmountDataWei", calculatedAmountDataWei);
        globalData().token.transfer(_msgSender(), calculatedAmountDataWei);
        emit InvestmentReturned(_msgSender(), calculatedAmountDataWei);
        // unallocatedWei -= amountWei;
    }

    /////////////////////////////////////////
    // BROKER FUNCTIONS
    /////////////////////////////////////////

    function stake(Bounty bounty, uint amountWei) external onlyBroker {
        // require(unallocatedWei >= amountWei, "error_notEnoughFreeFunds");
        globalData().token.approve(address(bounty), amountWei);
        bounty.stake(address(this), amountWei); // may fail if amountWei < MinimumStakeJoinPolicy.minimumStake
        staked[bounty] += amountWei;
        globalData().totalStakedWei += amountWei;
        // unallocatedWei -= amountWei;
        emit Staked(bounty, amountWei);
    }

    function unstake(Bounty bounty) external onlyBroker {
        console.log("unstake bounty", address(bounty));
        require(staked[bounty] > 0, "error_notStaked");
        uint balanceBefore = globalData().token.balanceOf(address(this));
        console.log("unstake balanceBefore", balanceBefore);
        bounty.leave();
        uint receivedWei = globalData().token.balanceOf(address(this)) - balanceBefore;
        console.log("unstake receivedWei", receivedWei);

        // unallocatedWei += receivedWei;
        if (receivedWei < staked[bounty]) {
            // TODO: slash handling
            uint lossesWei = staked[bounty] - receivedWei;
            emit Unstaked(bounty, staked[bounty], 0);
            emit Losses(bounty, lossesWei);
        } else {
            // TODO: gains handling
            uint gainsWei = receivedWei - staked[bounty];
            emit Unstaked(bounty, staked[bounty], gainsWei);
        }
        console.log("unstake totalstakedWei", globalData().totalStakedWei);
        globalData().totalStakedWei -= staked[bounty];
        uint winnings = receivedWei - staked[bounty];
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector,
            winnings), "error_yieldPolicy_deductBrokersPart_Failed");
        staked[bounty] = 0;
    }

    function withdrawWinningsFromBounty(Bounty bounty) external onlyBroker {
        require(staked[bounty] > 0, "error_notStaked");
        uint balanceBefore = globalData().token.balanceOf(address(this));
        console.log("withdrawWinnings balanceBefore", balanceBefore);
        bounty.withdraw();
        console.log("withdrawWinnings balanceAfter", globalData().token.balanceOf(address(this)));
        uint winnings = globalData().token.balanceOf(address(this)) - balanceBefore;
        console.log("withdrawWinnings winnings", winnings);
        moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.deductBrokersShare.selector,
            winnings), "error_yieldPolicy_deductBrokersPart_Failed");
    }

    function getQueuedDataPayout() public view returns (uint256 amountDataWei) {
        return queuedPayoutsDataWei[_msgSender()];
    }

    function getWithdrawableData() public view returns (uint256 amountDataWei) {
        uint poolTokenBalance = balanceOf(_msgSender());
        return moduleGet(abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector, poolTokenBalance), "error_getWithdrawableData_Failed");
    }

    function queueDataPayout(uint amountPoolTokenWei) external {
        require(amountPoolTokenWei > 0, "error_payout_amount_zero");
        require(balanceOf(_msgSender()) > 0, "error_notPoolTokens");
        uint256 amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            amountPoolTokenWei), "error_yieldPolicy_pooltokenToData_Failed");
        _burn(_msgSender(), amountPoolTokenWei);
        queuedPayoutsDataWei[_msgSender()] += amountDataWei;
        payoutQueue[payoutIndex] = _msgSender();
        payoutIndex++;
        emit QueuedDataPayout(_msgSender(), amountDataWei);
    }

    function unqueueDataPayout(uint amountDataWei) external {
        require(amountDataWei > 0, "error_payout_amount_zero");
        require(queuedPayoutsDataWei[_msgSender()] >= amountDataWei, "error_notEnoughData");
        queuedPayoutsDataWei[_msgSender()] -= amountDataWei;
        _mint(_msgSender(), amountDataWei);
        emit UnqueuedDataPayout(_msgSender(), amountDataWei);
    }
}
