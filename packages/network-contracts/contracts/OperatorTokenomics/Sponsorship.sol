// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
pragma experimental ABIEncoderV2;

// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./IERC677.sol";
import "./IERC677Receiver.sol";
import "./IOperator.sol";
import "./SponsorshipPolicies/IJoinPolicy.sol";
import "./SponsorshipPolicies/ILeavePolicy.sol";
import "./SponsorshipPolicies/IKickPolicy.sol";
import "./SponsorshipPolicies/IAllocationPolicy.sol";
import "./StreamrConfig.sol";


/**
 * `Sponsorship` ("Stream Agreement") holds the sponsors' tokens and allocates them to operators
 * Those tokens are the *sponsorship* that the *sponsor* puts on servicing the stream
 * *Operators* that have `stake`d on the Sponsorship and receive *earnings* specified by the `IAllocationPolicy`
 * Operators can also `unstake` and stop earning, signalling to stop servicing the stream.
 *  NB: If there's a flag on you (or by you) then some of your stake is locked on that flag, which prevents unstaking.
 *      If you really want to stop servicing the stream and are willing to lose the locked stake, you can `forceUnstake`
 *
 * The tokens held by `Sponsorship` are tracked in four accounts:
 * - totalStakedWei: total amount of tokens staked by all operators
 *  -> each operator has their `stakedWei`, part of which can be `lockedStakeWei` if there are flags on/by them
 * - remainingWei: part of the sponsorship that hasn't been paid out yet
 *  -> decides the `solventUntilTimestamp()`: more unallocated funds left means the `Sponsorship` is solvent for a longer time
 * - earningsWei: part of the sponsorship that has been paid out to operators but not yet withdrawn
 *  -> governed by the `IAllocationPolicy`
 * - forfeitedStakeWei: stakes that were locked to pay for a flag by a past operator who `forceUnstake`d (or was kicked)
 *  -> should be zero when there are no active flags
 *
 * @dev We track both earningsWei and remainingWei because there can be 'ghost tokens' from plain ERC20 transfers (instead of transferAndCall)
 * @dev It's important that whenever tokens are moved out (or unaccounted tokens detected) that they be accounted for
 * @dev   either via _stake/_slash (to/from stake) or _addSponsorship (to remainingWei)
 */
contract Sponsorship is Initializable, ERC2771ContextUpgradeable, IERC677Receiver, AccessControlUpgradeable {

    event StakeUpdate(address indexed operator, uint stakedWei, uint earningsWei);
    event SponsorshipUpdate(uint totalStakedWei, uint remainingWei, uint operatorCount, bool isRunning);
    event OperatorJoined(address indexed operator);
    event OperatorLeft(address indexed operator, uint returnedStakeWei);
    event SponsorshipReceived(address indexed sponsor, uint amount);
    event OperatorKicked(address indexed operator);
    event OperatorSlashed(address indexed operator, uint amountWei);

    // Emitted from the allocation policy
    event ProjectedInsolvencyUpdate(uint projectedInsolvencyTimestamp);
    event InsolvencyStarted(uint startTimeStamp);
    event InsolvencyEnded(uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);

    // Emitted from VoteKickPolicy
    event FlagUpdate(address indexed flagger, address target, uint targetLockedStake, uint result, string flagMetadata);

    error MinOperatorCountZero();
    error OnlyDATAToken();
    error MinimumStake();
    error CannotIncreaseStake();
    error OperatorNotStaked();
    // error OperatorAlreadyJoined();
    error LeavePenalty();
    error ModuleCallError(address moduleAddress, bytes callBytes);
    error ModuleGetError(bytes callBytes);
    error ActiveFlag();
    error TransferError();
    error FlaggingNotSupported();
    error AccessDenied();

    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    StreamrConfig public streamrConfig;
    IERC677 public token;
    IJoinPolicy[] public joinPolicies;
    IAllocationPolicy public allocationPolicy;
    ILeavePolicy public leavePolicy;
    IKickPolicy public kickPolicy;
    string public streamId;
    string public metadata;
    mapping(address => string) public flagMetadataJson;

    mapping(address => uint) public stakedWei; // how much each operator has staked, if 0 operator is considered not part of sponsorship
    mapping(address => uint) public joinTimeOfOperator;
    mapping(address => uint) public lockedStakeWei; // how much can not be unstaked (during e.g. flagging)
    uint public forfeitedStakeWei; // lockedStakeWei that has been forfeited but is still needed to e.g. pay the flag reviewers
    uint public totalStakedWei;
    uint public operatorCount;
    uint public minOperatorCount;
    uint public minHorizonSeconds;
    uint public remainingWei;
    uint public earningsWei; // only the IAllocationPolicy should modify this!

    function getMyStake() public view returns (uint) {
        return stakedWei[_msgSender()];
    }

    /**
     * You can't unstake the locked part or go below the minimum stake (by cashing out your stake),
     *   hence there is an individual limit for reduceStakeTo.
     * When joining, locked stake is zero, so the it's the same minimumStakeWei for everyone.
     */
    function minimumStakeOf(address operator) public view returns (uint) {
        uint minimumStakeWei = streamrConfig.minimumStakeWei();
        return max(lockedStakeWei[operator], minimumStakeWei);
    }

    /**
     * Running means there's enough operators signed up for the sponsorship,
     *  and the sponsorship should pay tokens to the operators from the remaining sponsorship
     * See https://hackmd.io/i8M8iFQLSIa9RbDn-d5Szg?view#Mechanisms
     */
    function isRunning() public view returns (bool) {
        return operatorCount >= minOperatorCount;
    }

    /**
     * Funded means there's enough sponsorship to cover minHorizonSeconds of payments to operators
     * DefaultLeavePolicy states operators are free to leave an underfunded sponsorship
     */
    function isFunded() public view returns (bool) {
        return solventUntilTimestamp() > block.timestamp + minHorizonSeconds; // solhint-disable-line not-rely-on-time
    }

    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    /**
     * @param initParams uint arguments packed into an array to avoid the "stack too deep" error
     *  [0] minHorizonSeconds: if there's less than this much sponsorship left, Operators can leave without penalty (not used for now)
     *  [1] minOperatorCount: when will the Sponsorship start paying (or stop paying if Operator count goes below this)
     *  [2] weiPerSecond (parameter sent to the allocation policy)
     */
    function initialize(
        string calldata streamId_,
        string calldata metadata_,
        StreamrConfig globalStreamrConfig,
        address tokenAddress,
        uint[3] calldata initParams,
        IAllocationPolicy initialAllocationPolicy
    ) public initializer {
        minHorizonSeconds = uint32(initParams[0]);
        minOperatorCount = uint32(initParams[1]);
        uint allocationPerSecond = initParams[2];

        if (minOperatorCount == 0) { revert MinOperatorCountZero(); }
        token = IERC677(tokenAddress);
        streamId = streamId_;
        metadata = metadata_;
        streamrConfig = globalStreamrConfig;
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender()); // factory needs this to set policies, (self-)revoke after policies are set!
        setAllocationPolicy(initialAllocationPolicy, allocationPerSecond);
    }

    /**
     * ERC677 token callback
     * If the data bytes contains an address, the incoming tokens are staked for that operator
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        if (msg.sender != address(token)) { revert OnlyDATAToken(); } // trusted forwarder should NOT be able to set this
        if (data.length == 20) {
            // shift the 20 address bytes (= 160 bits) to end of uint256 to populate an address variable => shift by 256 - 160 = 96
            // (this is what abi.encodePacked would produce)
            address stakeBeneficiary;
            assembly { stakeBeneficiary := shr(96, calldataload(data.offset)) } // solhint-disable-line no-inline-assembly
            _stake(stakeBeneficiary, amount);
        } else if (data.length == 32) {
            // assume the address was encoded by converting address -> uint -> bytes32 -> bytes
            // (already in the least significant bytes, no shifting needed; this is what abi.encode would produce)
            address stakeBeneficiary;
            assembly { stakeBeneficiary := calldataload(data.offset) } // solhint-disable-line no-inline-assembly
            _stake(stakeBeneficiary, amount);
        } else {
            _addSponsorship(sender, amount);
        }
    }

    /**
     * Sponsor a stream in one of three ways:
     * 1. 1-step ERC677: `DATA.transferAndCall(sponsorship.address, amountWei, "0x")` (preferred method!)
     * 2. 2-step ERC20: first `DATA.approve(sponsorship.address, amountWei)` then `sponsorship.sponsor(amountWei)` (ERC20 compatibility)
     * 3. 2-step ERC20: first `DATA.transfer(sponsorship.address, amountWei)` then `sponsorship.sponsor(0)` (fix if tokens were accidentally sent using ERC20.transfer)
     * Method 3 will not attribute the tokens to the sponsor, so it should be avoided and only considered as a fix.
     * The problem with ERC20.transfer is that it doesn't allow the recipient to know who sent the tokens, so the contract can't attribute them to the sender.
     */
    function sponsor(uint amountWei) external {
        if (amountWei > 0) {
            token.transferFrom(_msgSender(), address(this), amountWei);
        }
        _addSponsorship(_msgSender(), amountWei);
    }

    function _addSponsorship(address sponsorAddress, uint tokensFromSponsorWei) internal {
        // sweep all non-staked tokens into "unallocated" bin (remainingWei). This also takes care of tokens sent using plain `ERC20.transfer` without calling `sponsor`
        uint remainingWeiBefore = remainingWei;
        remainingWei = token.balanceOf(address(this)) - earningsWei - totalStakedWei - forfeitedStakeWei;
        uint newTokensWei = remainingWei - remainingWeiBefore;

        // tokens can't be lost if ERC677.onTokenTransfer or ERC20.transferFrom works correctly ==> assume newTokens >= amount
        uint unknownTokensWei = newTokensWei - tokensFromSponsorWei;

        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onSponsor.selector, sponsorAddress, newTokensWei));
        emit SponsorshipReceived(sponsorAddress, tokensFromSponsorWei);
        if (unknownTokensWei > 0) {
            emit SponsorshipReceived(address(0), unknownTokensWei);
        }
        emit SponsorshipUpdate(totalStakedWei, remainingWei, uint32(operatorCount), isRunning());
    }

    /**
     * Stake by first calling DATA.approve(sponsorship.address, amountWei) then this function (2-step ERC20)
     *   or alternatively call DATA.transferAndCall(sponsorship.address, amountWei, operatorAddress) (1-step ERC677)
     * @param operator the operator to stake for (can stake on behalf of someone else)
     */
    function stake(address operator, uint amountWei) external {
        token.transferFrom(_msgSender(), address(this), amountWei);
        _stake(operator, amountWei);
    }

    function _stake(address operator, uint amountWei) internal {
        bool newStaker = stakedWei[operator] == 0;
        stakedWei[operator] += amountWei;
        totalStakedWei += amountWei;
        if (stakedWei[operator] < streamrConfig.minimumStakeWei()) { revert MinimumStake(); }

        if (newStaker) {
            operatorCount += 1;
            joinTimeOfOperator[operator] = block.timestamp; // solhint-disable-line not-rely-on-time
            for (uint i = 0; i < joinPolicies.length; i++) {
                IJoinPolicy joinPolicy = joinPolicies[i];
                moduleCall(address(joinPolicy), abi.encodeWithSelector(joinPolicy.onJoin.selector, operator, amountWei));
            }
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onJoin.selector, operator));
            emit OperatorJoined(operator);
        } else {
            moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onStakeChange.selector, operator, int(amountWei)));
        }

        emit StakeUpdate(operator, stakedWei[operator], getEarnings(operator));
        emit SponsorshipUpdate(totalStakedWei, remainingWei, uint32(operatorCount), isRunning());
    }

    /**
     * Get all the stake and allocations out
     * Throw if that's not possible due to open flags or leave penalty (e.g. leaving too early)
     */
    function unstake() public returns (uint payoutWei) {
        address operator = _msgSender();
        if (getLeavePenalty(operator) > 0) { revert LeavePenalty(); }
        if (lockedStakeWei[operator] > 0) { revert ActiveFlag(); }
        payoutWei = _removeOperator(operator);
    }

    /** Get both stake and allocations out, forfeitting leavePenalty and all stake that is locked to pay for flags */
    function forceUnstake() public returns (uint payoutWei) {
        address operator = _msgSender();
        uint penaltyWei = getLeavePenalty(operator);
        if (penaltyWei > 0) {
            uint slashedWei = _slash(operator, penaltyWei);
            _addSponsorship(address(this), slashedWei);
        }
        payoutWei = _removeOperator(operator); // forfeits locked stake
    }

    /** Reduce your stake in the sponsorship without leaving */
    function reduceStakeTo(uint targetStakeWei) external returns (uint payoutWei) {
        address operator = _msgSender();
        if (targetStakeWei >= stakedWei[operator]) { revert CannotIncreaseStake(); }
        if (targetStakeWei < minimumStakeOf(operator)) { revert MinimumStake(); }

        payoutWei = _reduceStakeBy(operator, stakedWei[operator] - targetStakeWei);
        token.transfer(operator, payoutWei);

        emit StakeUpdate(operator, stakedWei[operator], getEarnings(operator));
        emit SponsorshipUpdate(totalStakedWei, remainingWei, uint32(operatorCount), isRunning());
    }

    /**
     * Slashing removes tokens from an operator's stake (and does NOT put them e.g. into remainingWei!)
     * NOTE: The caller MUST ensure those tokens are added to some other account, e.g. remainingWei, via _addSponsorship
     **/
    function _slash(address operator, uint amountWei) internal returns (uint actualSlashingWei) {
        actualSlashingWei = _reduceStakeBy(operator, amountWei);
        if (operator.code.length > 0) {
            try IOperator(operator).onSlash(actualSlashingWei) {} catch {}
        }
        emit OperatorSlashed(operator, actualSlashingWei);
        emit StakeUpdate(operator, stakedWei[operator], getEarnings(operator));
    }

    /**
     * Kicking does what slashing does, plus removes the operator
     * NOTE: The caller MUST ensure that slashed tokens (if any) are added to some other account, e.g. remainingWei, via _addSponsorship
     */
    function _kick(address operator, uint slashingWei) internal {
        if (slashingWei > 0) {
            slashingWei = _reduceStakeBy(operator, slashingWei);
            emit OperatorSlashed(operator, slashingWei);
        }
        uint payoutWei = _removeOperator(operator);
        if (operator.code.length > 0) {
            try IOperator(operator).onKick(slashingWei, payoutWei) {} catch {}
        }
        emit OperatorKicked(operator);
    }

    /**
     * Removes tokens from an operator's stake (and does NOT put them e.g. into remainingWei!)
     * NOTE: Does not actually send out tokens, only does the accounting!
     * NOTE: The caller MUST ensure those tokens are added to some other account, e.g. remainingWei, via _addSponsorship
     **/
    function _reduceStakeBy(address operator, uint amountWei) private returns (uint actualReductionWei) {
        actualReductionWei = min(amountWei, stakedWei[operator]);
        stakedWei[operator] -= actualReductionWei;
        totalStakedWei -= actualReductionWei;
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onStakeChange.selector, operator, -int(actualReductionWei)));
    }

    /**
     * Operator stops servicing the stream and withdraws their stake + earnings.
     * If number of operators falls below minOperatorCount, the sponsorship will no longer be "running" and the stream will be closed.
     * If operator had any locked stake, it is accounted as "forfeited stake" and will henceforth be controlled by the VoteKickPolicy.
     */
    function _removeOperator(address operator) internal returns (uint payoutWei) {
        if (stakedWei[operator] == 0) { revert OperatorNotStaked(); }

        if (lockedStakeWei[operator] > 0) {
            uint slashedWei = _slash(operator, lockedStakeWei[operator]);
            forfeitedStakeWei += slashedWei;
            lockedStakeWei[operator] = 0;
        }

        // send out both allocations and stake
        uint paidOutEarningsWei = _withdraw(operator);
        uint paidOutStakeWei = stakedWei[operator];

        operatorCount -= 1;
        totalStakedWei -= paidOutStakeWei;
        delete stakedWei[operator];
        delete joinTimeOfOperator[operator];

        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onLeave.selector, operator));
        emit StakeUpdate(operator, 0, 0); // stake and allocation must be zero when the operator is gone
        emit SponsorshipUpdate(totalStakedWei, remainingWei, uint32(operatorCount), isRunning());
        emit OperatorLeft(operator, paidOutStakeWei);

        // do the transferAndCall in the end of the function to avoid reentrancy (stakedWei[operator] == 0 now, so re-entry would fail with OperatorNotStaked)
        try { token.transferAndCall(operator, paidOutStakeWei, "stake") } catch {}

        return paidOutEarningsWei + paidOutStakeWei;
    }

    /** Get earnings out, leave stake in */
    function withdraw() external returns (uint payoutWei) {
        address operator = _msgSender();
        if (stakedWei[operator] == 0) { revert OperatorNotStaked(); }

        payoutWei = _withdraw(operator);
        if (payoutWei > 0) {
            emit StakeUpdate(operator, stakedWei[operator], 0); // earnings will be zero after withdraw (see test)
            emit SponsorshipUpdate(totalStakedWei, remainingWei, uint32(operatorCount), isRunning());
        }
    }

    function _withdraw(address operator) internal returns (uint payoutWei) {
        payoutWei = moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.onWithdraw.selector, operator));
        if (payoutWei > 0) {
            if (!token.transferAndCall(operator, payoutWei, "allocation")) { revert TransferError(); }
        }
    }

    /**
     * Start the flagging process to kick an abusive operator and pass arbitrary metadata object along with the flag
     * The intended use for the metadata is to communicate the partition number and/or other conditions relevant to the failed inspection. The passed metadata is only used off-chain.
    */
    function flag(address target, string memory metadataJsonString) external {
        flagMetadataJson[target] = metadataJsonString;
        if (address(kickPolicy) == address(0)) { revert FlaggingNotSupported(); }
        moduleCall(address(kickPolicy), abi.encodeWithSelector(kickPolicy.onFlag.selector, target));
    }

    /** Peer reviewers vote on the flag */
    function voteOnFlag(address target, bytes32 voteData) external {
        if (address(kickPolicy) == address(0)) { revert FlaggingNotSupported(); }
        moduleCall(address(kickPolicy), abi.encodeWithSelector(kickPolicy.onVote.selector, target, voteData));
    }

    /** Read information about a flag, see the flag policy how that info is packed into the 256 bits of flagData */
    function getFlag(address target) external view returns (uint flagData, string memory flagMetadata) {
        if (address(kickPolicy) == address(0)) { revert FlaggingNotSupported(); }
        flagData = moduleGet(abi.encodeWithSelector(kickPolicy.getFlagData.selector, target, address(kickPolicy)));
        flagMetadata = flagMetadataJson[target];
    }

    /////////////////////////////////////////
    // POLICY SETUP
    // This should happen during initialization and be done by the SponsorshipFactory
    /////////////////////////////////////////

    function setAllocationPolicy(IAllocationPolicy newAllocationPolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        allocationPolicy = newAllocationPolicy;
        moduleCall(address(allocationPolicy), abi.encodeWithSelector(allocationPolicy.setParam.selector, param));
    }

    function setLeavePolicy(ILeavePolicy newLeavePolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        leavePolicy = newLeavePolicy;
        moduleCall(address(leavePolicy), abi.encodeWithSelector(leavePolicy.setParam.selector, param));
    }

    function setKickPolicy(IKickPolicy newKickPolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        kickPolicy = newKickPolicy;
        moduleCall(address(kickPolicy), abi.encodeWithSelector(kickPolicy.setParam.selector, param));
    }

    function addJoinPolicy(IJoinPolicy newJoinPolicy, uint param) public onlyRole(DEFAULT_ADMIN_ROLE) {
        joinPolicies.push(newJoinPolicy);
        moduleCall(address(newJoinPolicy), abi.encodeWithSelector(newJoinPolicy.setParam.selector, param));
    }

    /////////////////////////////////////////
    // MODULE CALLS
    // moduleCall for transactions, moduleGet for view functions
    /////////////////////////////////////////
    /* solhint-disable */

    /**
     * Delegate-call ("library call") a module's method: it will use this Sponsorship's storage
     * When calling from a view function (staticcall context), use moduleGet instead
     */
    function moduleCall(address moduleAddress, bytes memory callBytes) internal returns (uint returnValue) {
        (bool success, bytes memory returndata) = moduleAddress.delegatecall(callBytes);
        if (!success) {
            if (returndata.length == 0) { revert ModuleCallError(moduleAddress, callBytes); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
        // assume a successful call returns precisely one uint256 or nothing, so take that out and drop the rest
        // for the function that return nothing, the returnValue will just be garbage
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
        if (msg.sender != address(this)) { // trusted forwarder should NOT be able to set this
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

    /** Call a module's view function (staticcall) */
    function moduleGet(bytes memory callBytes) internal view returns (uint returnValue) {
        // trampoline through the above callback
        (bool success, bytes memory returndata) = address(this).staticcall(callBytes);
        if (!success) {
            if (returndata.length == 0) { revert ModuleGetError(callBytes); }
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
        // assume a successful call returns precisely one uint256, so take that out and drop the rest
        assembly { returnValue := mload(add(returndata, 32)) }
    }

    /* solhint-enable */

    function solventUntilTimestamp() public view returns(uint horizon) {
        return moduleGet(abi.encodeWithSelector(allocationPolicy.getInsolvencyTimestamp.selector, address(allocationPolicy)));
    }

    function getEarnings(address operator) public view returns(uint allocation) {
        return moduleGet(abi.encodeWithSelector(allocationPolicy.getEarningsWei.selector, operator, address(allocationPolicy)));
    }

    function getLeavePenalty(address operator) public view returns(uint leavePenalty) {
        if (address(leavePolicy) == address(0)) { return 0; }
        return moduleGet(abi.encodeWithSelector(leavePolicy.getLeavePenaltyWei.selector, operator, address(leavePolicy)));
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }
    function max(uint a, uint b) internal pure returns (uint) {
        return a > b ? a : b;
    }
}
