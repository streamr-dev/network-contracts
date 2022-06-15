// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

import "./IERC677.sol";
import "./IERC677Receiver.sol";

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./Bounty.sol";

// import "hardhat/console.sol";

/**
 * Broker Pool receives a delegators' investments and pays out yields
 * It also is an ERC20 token for the pool tokens
 */
contract BrokerPool is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable { //}, ERC2771Context {

    event InvestmentReceived(address indexed investor, uint amountWei);
    event InvestmentReturned(address indexed investor, uint amountWei);
    event Staked(Bounty indexed bounty, uint amountWei);
    event Losses(Bounty indexed bounty, uint amountWei);
    event Unstaked(Bounty indexed bounty, uint stakeWei, uint gainsWei);

    // bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    IERC677 public token;
    address public broker;
    uint public minimumInvestmentWei;
    uint public unallocatedWei;

    mapping(address => uint) public debt;
    mapping(address => uint) public earnings;
    mapping(Bounty => uint) public staked;

    function initialize(
        address tokenAddress,
        address brokerAddress,
        address trustedForwarderAddress,
        uint initialMinimumInvestmentWei
    ) public initializer {
        // __AccessControl_init();
        // _setupRole(DEFAULT_ADMIN_ROLE, newOwner);
        // _setupRole(ADMIN_ROLE, newOwner);
        // _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE); // admins can make others admin, too
        token = IERC677(tokenAddress);
        broker = brokerAddress;
        minimumInvestmentWei = initialMinimumInvestmentWei;
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
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
        require(_msgSender() == address(token), "error_onlyTokenContract");

        // check if sender is a bounty: only bounties may have tokens _staked_ on them
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
        token.transferFrom(_msgSender(), address(this), amountWei);
        _invest(_msgSender(), amountWei);
    }

    function _invest(address investor, uint amountWei) internal {
        unallocatedWei += amountWei;
        // TODO: mint pool tokens to investor
        emit InvestmentReceived(investor, amountWei);
    }

    function withdrawAll() external {
        uint amountWei = 1; // TODO
        withdraw(amountWei);
    }

    function withdraw(uint amountWei) public {
        token.transferAndCall(_msgSender(), amountWei, "0x");
        _withdraw(_msgSender(), amountWei);
    }

    function _withdraw(address investor, uint amountWei) internal {
        unallocatedWei -= amountWei;
        // TODO: burn investor's pool tokens
        emit InvestmentReturned(investor, amountWei);
    }

    /////////////////////////////////////////
    // BROKER FUNCTIONS
    /////////////////////////////////////////

    function stake(Bounty bounty, uint amountWei) external {
        require(_msgSender() == broker, "error_brokerOnly");
        require(staked[bounty] == 0, "error_alreadyStaked");
        require(unallocatedWei >= amountWei, "error_notEnoughFreeFunds");
        token.approve(address(bounty), amountWei);
        bounty.stake(address(this), amountWei); // may fail if amountWei < MinimumStakeJoinPolicy.minimumStake
        staked[bounty] = amountWei;
        unallocatedWei -= amountWei;
        emit Staked(bounty, amountWei);
    }

    function unstake(Bounty bounty) external {
        // console.log("unstake", address(bounty));
        require(staked[bounty] > 0, "error_notStaked");
        require(_msgSender() == broker, "error_brokerOnly");

        uint balanceBefore = token.balanceOf(address(this));
        bounty.leave();
        uint receivedWei = token.balanceOf(address(this)) - balanceBefore;

        unallocatedWei += receivedWei;
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
        staked[bounty] = 0;
    }
}
