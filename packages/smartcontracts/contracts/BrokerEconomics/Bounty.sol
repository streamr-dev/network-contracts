// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

// import "@openzeppelin/contracts/access/AccessControl.sol";
// import "../metatx/ERC2771Context.sol";

import "./IERC677.sol";
import "./IERC677Receiver.sol";

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
// import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./policies/IJoinPolicy.sol";
import "./policies/ILeavePolicy.sol";
import "./policies/IAllocationPolicy.sol";

import "hardhat/console.sol";


/**
 * Stream Agreement holds the sponsors' tokens and allocates them to brokers
 */
contract Bounty is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable { //}, ERC2771Context {

    // see https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Mechanisms
    enum State {
        Closed,     // horizon < minHorizon and brokerCount fallen below minBrokerCount
        Warning,    // brokerCount > minBrokerCount, but horizon < minHorizon ==> brokers can leave without penalty
        Funded,     // horizon > minHorizon, but brokerCount still below minBrokerCount
        Running     // horizon > minHorizon and minBrokerCount <= brokerCount <= maxBrokerCount
    }

    event StakeAdded(address indexed broker, uint addedWei, uint totalWei);
    event BrokerJoined(address indexed broker);
    event BrokerLeft(address indexed broker, uint returnedStakeWei);
    event StateChanged(State newState);
    event SponsorshipReceived(address indexed sponsor, uint amount);

    struct GlobalState {
        State bountyState;
        uint brokersCount;
        /** how much each broker has staked, if 0 broker is considered not part of bounty */
        mapping(address => uint) stakedWei;
        uint totalStakedWei;
        /** the timestamp a broker joined, to determine how long he has been a member,
            - option 1: must be set to 0 once broker leaves, must always be checked for 0
            - option 2: must be set to MAXINT once broker leaves, must be checked if < than now()*/
        mapping(address => uint) joinTimeOfBroker;
        uint unallocatedFunds;
    }

    mapping(address => bool) public approvedPolicies;
    IERC677 public token;
    address[] public joinPolicyAddresses;
    IAllocationPolicy public allocationPolicy;
    ILeavePolicy public leavePolicy;
    // IJoinPolicy joinPolicy;
    // address[] public brokers;
    // unallocated funds: totalFunds from tokencontract - allocatedFunds

    // these into policy?
    // uint public minHorizonSeconds;
    uint public allocationWeiPerSecond;

    // ???
    // uint public cumulativeUnitEarningsWei;  // CUE = how much earnings have accumulated per weight-unit
    // uint public cueTimestamp;
    // uint public totalSponsorshipsAtCueTimestamp;
    // mapping(address => uint) public cueAtJoinWei;

    modifier isAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "error_mustBeAdminRole");
        _;
    }
    // uint public totalWeight; // TODO: weighting
    // whole-stream state, see https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Global-State
    // uint public startCue;           // CUE when StateChanged(Running)
    // uint public startTimestamp;     // block.timestamp when StateChanged(Running)
    // broker-specific state
    // mapping(address => uint) public weight; // TODO: weighting
    // constructor(
    //     address tokenAddress,
    //     uint initialAllocationWeiPerSecond,
    //     uint initialMinBrokerCount,
    //     uint initialMaxBrokerCount,
    //     uint initialMinimumStakeWei,
    //     uint initialMinHorizonSeconds
    // ) {
    //     token = IERC677(tokenAddress);
    //     allocationWeiPerSecond = initialAllocationWeiPerSecond;
    //     minBrokerCount = initialMinBrokerCount;
    //     maxBrokerCount = initialMaxBrokerCount;
    //     minimumStakeWei = initialMinimumStakeWei;
    //     minHorizonSeconds = initialMinHorizonSeconds;
    // }

    function initialize(address newOwner,
        address tokenAddress,
        uint initialAllocationWeiPerSecond,
        uint initialMinHorizonSeconds,
        address trustedForwarderAddress) public initializer {
        // __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, newOwner);
        // ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        token = IERC677(tokenAddress);
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        allocationWeiPerSecond = initialAllocationWeiPerSecond;
        // minHorizonSeconds = initialMinHorizonSeconds;
        allocationWeiPerSecond = initialAllocationWeiPerSecond;

    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function addJoinPolicy(address _joinPolicyAddress, uint256 param) public isAdmin {
        joinPolicyAddresses.push(_joinPolicyAddress);
        (bool success, bytes memory returndata) = _joinPolicyAddress.delegatecall(
            abi.encodeWithSignature("setParam(uint256)", param)
        );
        require(success, "error adding join policy");
    }

    function setAllocationPolicy(address _allocationPolicyAddress, uint256 param) public isAdmin {
        allocationPolicy = IAllocationPolicy(_allocationPolicyAddress);
        (bool success, bytes memory data) = _allocationPolicyAddress.delegatecall(
            abi.encodeWithSignature("setParam(uint256)", param)
        );
        require(success, "error adding join policy");
    }

    function setLeavePolicy(address _leaveAddress, uint256 param) public isAdmin {
        leavePolicy = ILeavePolicy(_leaveAddress);
        (bool success, bytes memory data) = _leaveAddress.delegatecall(
            abi.encodeWithSignature("setParam(uint256)", param)
        );
        require(success, "error adding leave policy");
    }

    function globalData() internal pure returns(GlobalState storage data) {
        bytes32 storagePosition = keccak256("agreement.storage.globalState");
        assembly {data.slot := storagePosition}
    }

    function getUnallocatedWei() public view returns(uint) {
        GlobalState storage data = globalData();
        return data.unallocatedFunds;
    }


    fallback() external  {
        require(msg.sender == address(this));

        (bool success, bytes memory data) = address(allocationPolicy).delegatecall(msg.data);
        assembly {
            switch success
                // delegatecall returns 0 on error.
                case 0 { revert(add(data, 32), returndatasize()) }
                default { return(add(data, 32), returndatasize()) }
        }
    }

    // to be able to use delegatecall in a view function we must go through the fallback with delegatecall
    function getAllocation(address broker) public view returns(uint256) {
        (bool success, bytes memory data) = address(this).staticcall(
            abi.encodeWithSelector(
                allocationPolicy.calculateAllocation.selector,
                broker
            )
        );

        assembly {
            switch success
                case 0 { revert(add(data, 32), returndatasize()) }
                default { return(add(data, 32), returndatasize()) }
        }
    }

    function getPenaltyOnStake(address broker) public view returns(uint256) {
        (bool success, bytes memory data) = address(this).staticcall(
            abi.encodeWithSelector(
                allocationPolicy.calculatePenaltyOnStake.selector,
                broker
            )
        );

        assembly {
            switch success
                case 0 { revert(add(data, 32), returndatasize()) }
                default { return(add(data, 32), returndatasize()) }
        }
    }

    /**
     * ERC677 token callback
     * If the data bytes contains an address, the incoming tokens are staked for that broker
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        require(_msgSender() == address(token), "error_onlyTokenContract");
        if (data.length == 20) {
            // shift 20 bytes (= 160 bits) to end of uint256 to make it an address => shift by 256 - 160 = 96
            // (this is what abi.encodePacked would produce)
            address stakeBeneficiary;
            assembly {
                stakeBeneficiary := shr(96, calldataload(data.offset))
            }
            _stake(stakeBeneficiary, amount);
        } else if (data.length == 32) {
            // assume the address was encoded by converting address -> uint -> bytes32 -> bytes (already in the least significant bytes)
            // (this is what abi.encode would produce)
            address stakeBeneficiary;
            assembly {
                stakeBeneficiary := calldataload(data.offset)
            }
            _stake(stakeBeneficiary, amount);
        } else {
            // TODO: maybe 0x or non-address data should always be sponsorship?
            if (data.length == 0) {
                _stake(sender, amount);
            }
            _sponsor(amount);
        }
    }

    /** Stake by first calling ERC20.approve(bounty.address, amountTokenWei) then this function */
    function stake(address broker, uint amountTokenWei) external {
        token.transferFrom(_msgSender(), address(this), amountTokenWei);
        _stake(broker, amountTokenWei);
    }

    function _stake(address broker, uint amount) internal {
        // not yet joined
        if (globalData().stakedWei[broker] == 0) {
            for (uint i = 0; i < joinPolicyAddresses.length; i++) {
                address joinPolicyAddress = joinPolicyAddresses[i];
                (bool success, bytes memory returndata) = joinPolicyAddress.delegatecall(
                    abi.encodeWithSignature("checkAbleToJoin(address,uint256)", broker, amount)
                );
                if (!success) {
                    if (returndata.length == 0) revert();
                    assembly {
                        revert(add(32, returndata), mload(returndata))
                    }
                }
                require(success, "error_adding_broker");
            }
            // (bool success, bytes memory data) = joinPolicyAddress.delegatecall(
            //     abi.encodeWithSignature("checkAbleToJoin(address,uint256)", broker, amount)
            // );
            // require(success, "error_join");
            console.log("join1 amount add", amount, broker);
            globalData().stakedWei[broker] += amount;
            console.log("join1 stake", globalData().stakedWei[broker]);
            globalData().brokersCount += 1;
            globalData().totalStakedWei += amount;
            console.log("join1 total stake", globalData().totalStakedWei);
            globalData().joinTimeOfBroker[broker] = block.timestamp;
            (bool success, bytes memory returndata) = address(allocationPolicy).delegatecall(
                abi.encodeWithSignature("onJoin(address)", broker)
            );
            require(success, "error_in_onjoin");
            // if (brokers[broker] == address(0)) {
            //     console.log("Adding broker ", broker, " amount ", amount);
            //     brokers.push(broker);
            // }
            console.log("joinPolicy.delegatecall");

            // cueAtJoinWei[broker] = cumulativeUnitEarningsWei;
            emit BrokerJoined(broker);
            console.log("BrokerJoined");

        } else {
            // already joinend, increasing stake
            globalData().stakedWei[broker] += amount;
            globalData().totalStakedWei += amount;

            // re-calculate the cumulative earnings for this broker
            (bool success, bytes memory returndata) = address(allocationPolicy).delegatecall(
                abi.encodeWithSignature("onStakeIncrease(address)", broker)
            );
            if (!success) {
                if (returndata.length == 0) revert();
                assembly {
                    revert(add(32, returndata), mload(returndata))
                }
            }
        }
        // TODO: if brokers.length > minBrokerCount { emit StateChanged(Running); }
    }

        /**
     * Broker stops servicing the stream and withdraws their stake + earnings.
     * Stake is returned only if there's not enough unallocated tokens to cover minHorizonSeconds.
     * If number of brokers falls below minBrokerCount, the stream is closed.
     */
    function leave() external {
        console.log("leaving1");
        uint slashPenaltyWei = this.getPenaltyOnStake(_msgSender());
        console.log("leaving1", _msgSender(), slashPenaltyWei);
        uint returnFunds = globalData().stakedWei[_msgSender()] - slashPenaltyWei;
        console.log("leaving2 stake", globalData().stakedWei[_msgSender()]);
        console.log("leaving2 returnfunds", returnFunds);
        returnFunds += this.getAllocation(_msgSender());
        console.log("leaving3", returnFunds);
        require(token.transfer(_msgSender(), returnFunds), "error_transfer");

        // add forfeited stake to unallocated funds...
        _sponsor(slashPenaltyWei);
        console.log("leaving4", globalData().unallocatedFunds);
        globalData().brokersCount -= 1;
        globalData().totalStakedWei -= globalData().stakedWei[_msgSender()];
        globalData().stakedWei[_msgSender()] = 0;
        globalData().joinTimeOfBroker[_msgSender()] = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

        console.log("leaving5", globalData().unallocatedFunds);
        (bool success, bytes memory returndata) = address(allocationPolicy).delegatecall(
            abi.encodeWithSignature("onLeave(address)", _msgSender())
        );
        if (!success) {
            if (returndata.length == 0) revert();
            assembly {
                revert(add(32, returndata), mload(returndata))
            }
        }
        console.log("returned funds", _msgSender(), returnFunds);
        emit BrokerLeft(_msgSender(), returnFunds);
        // removeFromAddressArray(brokers, broker);

        // TODO: if (brokers.length < minBrokerCount) { emit StateChanged(Closed); }
    }

    /** Sponsor a stream by first calling ERC20.approve(agreement.address, amountTokenWei) then this function */
    function sponsor(uint amountTokenWei) external {
        token.transferFrom(_msgSender(), address(this), amountTokenWei);
        _sponsor(amountTokenWei);
    }

    function _sponsor(uint amountTokenWei) internal {
        globalData().unallocatedFunds += amountTokenWei;
        // refresh();
        emit SponsorshipReceived(_msgSender(), amountTokenWei);
    }

    // function sliceUint(bytes memory bs, uint start) internal pure returns (uint) {
    //     require(bs.length >= start + 32, "slicing out of range");
    //     uint x;
    //     assembly {
    //         x := mload(add(bs, add(0x20, start)))
    //     }
    //     return x;
    // }

    // function getAllocation(address broker) view public returns(uint) {
    //     (bool success, bytes memory data) = allocationPolicyAddress.staticcall(
    //         abi.encodeWithSignature("calculateAllocation(address)", broker)
    //     );
    //     if (success) {
    //         // return sliceUint(data, 0);
    //         console.log("success");
    //         return abi.decode(data, (uint));
    //         // return data;
    //     } else {
    //         console.log("error");
    //         return 0;
    //     }
    // }


    // function getState() public view returns (State) {
    //     bool funded = horizonSeconds() < minHorizonSeconds;
    //     bool manned = brokers.length >= minBrokerCount;
    //     return funded ? manned ? State.Running : State.Funded :
    //                     manned ? State.Warning : State.Closed;
    // }

    // function getBalances() internal view returns (uint owedWei, uint unallocatedFunds) {
    //     owedWei = allocationWeiPerSecond * (block.timestamp - cueTimestamp); // solhint-disable-line not-rely-on-time
    //     unallocatedFunds = token.balanceOf(address(this)) - allocatedFunds;
    // }

    // function withdrawableEarnings(address /*broker*/) public view returns (uint) {
    //     (uint owedWei, uint remainingWei) = getBalances();
    //     uint payableWei = remainingWei > owedWei ? owedWei : remainingWei;
    //     uint newUnitEarningsWei = payableWei / brokers.length; //  / totalWeight
    //     return cumulativeUnitEarningsWei + newUnitEarningsWei; //  ) * weight[broker];
    // }

    /**
     * Tokens available to distribute to brokers as earnings.
     * When this goes to zero, the contract is bankrupt and stops giving earnings until further sponsorships are received.
     * New sponsorships pay first to brokers who were in contract while it was bankrupt.
     * TODO: should new sponsorships only pay new earnings and not "debt"?
     * Agreement will be closed only after enough brokers leave that there's less than minBrokerCount left
     */
    // function unallocatedWei() public view returns (uint) {
    //     (uint owedWei, uint remainingWei) = getBalances();
    //     return remainingWei > owedWei ? remainingWei - owedWei : 0;
    // }

    /**
     * Horizon is how long time the currently unallocated funds cover.
     * Horizon can be increased by sponsoring this stream.
     */
    // function horizonSeconds() public view returns (uint) {
    //     return 1 ether * unallocatedWei() / allocationWeiPerSecond;
    // }

    // function _stake(address broker, uint amountTokenWei) internal {
    //     stakedWei[broker] += amountTokenWei;
    //     allocatedFunds += amountTokenWei;
    //     emit StakeAdded(broker, amountTokenWei, stakedWei[broker]);
    // }

    // /**
    //  * Can be called by anyone to update the cumulativeUnitEarningsWei
    //  */
    // function refresh() public {
    //     (, uint totalSponsorships) = getBalances();
    //     uint newSponsorships = totalSponsorships - totalSponsorshipsAtCueTimestamp;
    //     emit SponsorshipReceived(msg.sender, newSponsorships);
    // }



    /**
     * Stake for a broker by first calling ERC20.approve(agreement.address, amountTokenWei) then this function
     */
    // function stake(address broker, uint amountTokenWei) public {
    //     // require(token.transferFrom(msg.sender, address(this), amountTokenWei), "error_transfer");
    //     _stake(broker, amountTokenWei);

    //     // stakedWei is zero for non-joined brokers
    //     if (brokers.length < maxBrokerCount && stakedWei[broker] >= minimumStakeWei) {
    //         _join(broker);
    //     }
    // }


    /**
     * Interpret the incoming ERC677 token transfer as follows:
     * Sponsor a stream with ERC677.transferAndCall(agreement.address, amountTokenWei, "0x")
     * Stake for a broker (and join) with ERC677.transferAndCall(agreement.address, amountTokenWei, brokerAddress)
     */
    // function onTokenTransfer(address, uint256 value, bytes calldata data) override external {
    //     require(msg.sender == address(token), "error_onlyTokenContract");
    //     if (data.length == 0) {
    //         refresh();
    //     } else if (data.length == 20) {
    //         address brokerAddress = address(bytes20(data));
    //         stake(brokerAddress, value);
    //     } else {
    //         revert("error_badErc677TransferData");
    //     }
    // }

    // TODO: withdrawAll, withdrawTo, withdrawToSigned, ... consider a withdraw module?
    // function withdraw(uint amountTokenWei) external {
    //     address broker = msg.sender;
    //     stakedWei[broker] -= amountTokenWei;
    //     allocatedFunds -= amountTokenWei;
    //     token.transfer(broker, amountTokenWei);
    // }

    // /**
    //  * Remove the listener from array by copying the last element into its place so that the arrays stay compact
    //  */
    // function removeFromAddressArray(address[] storage array, address element) internal returns (bool success) {
    //     uint i = 0;
    //     while (i < array.length && array[i] != element) { i += 1; }
    //     return removeFromAddressArrayUsingIndex(array, i);
    // }

    // /**
    //  * Remove the listener from array by copying the last element into its place so that the arrays stay compact
    //  */
    // function removeFromAddressArrayUsingIndex(address[] storage array, uint index) internal returns (bool success) {
    //     // TODO: if broker order in array makes a difference, either move remaining items back (linear time) or use heap (log time)
    //     if (index < 0 || index >= array.length) return false;
    //     if (index < array.length - 1) {
    //         array[index] = array[array.length - 1];
    //     }
    //     array.pop();
    //     return true;
    // }

}
