// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "../IERC677.sol";
import "../IERC677Receiver.sol";
import "../Sponsorship.sol";
import "../IOperator.sol";
import "../IVoterRegistry.sol";

/** This operator tries to prevent Sponsorship from working by reverting in callbacks */
contract TestBadOperator is IERC677Receiver, IOperator {

    bool public shouldRevertOnReviewRequest = false;
    bool public shouldRevertGetOwner = false;

    IERC677 public token;
    IVoterRegistry public voterRegistry;

    // asked by VoteKickPolicy
    uint public valueWithoutEarnings = 100 ether;
    function owner() public view returns (address) {
        require(shouldRevertGetOwner == false, "TestBadOperator.owner: revert");
        return 0x1337000000000000000000000000000000000000;
    }

    function setShouldRevertGetOwner(bool shouldRevert) external {
        shouldRevertGetOwner = shouldRevert;
    }

    // asked by factory
    bytes32 public DEFAULT_ADMIN_ROLE = bytes32(0); // solhint-disable-line var-name-mixedcase

    // asked by IVoterRegistry
    uint public totalStakedIntoSponsorshipsWei = 100 ether;

    function setReviewRequestReverting(bool shouldRevert) external {
        shouldRevertOnReviewRequest = shouldRevert;
    }

    // if TestBadOperator is created without factory, leave config empty to avoid calling back
    function initialize(address tokenAddress, address config, address, string memory, string memory, uint, address[3] memory) public {
        token = IERC677(tokenAddress);
        if (config != address(0)) {
            voterRegistry = IVoterRegistry(msg.sender);
        }
    }

    function stake(Sponsorship sponsorship, uint amountWei) public {
        token.approve(address(sponsorship), amountWei);
        sponsorship.stake(address(this), amountWei);
        valueWithoutEarnings = amountWei;
        totalStakedIntoSponsorshipsWei = amountWei;
        if (address(voterRegistry) != address(0)) {
            voterRegistry.voterUpdate(address(this));
        }
    }

    function unstake(Sponsorship sponsorship) public {
        sponsorship.unstake();
    }

    function flag(Sponsorship sponsorship, address targetOperator, string memory flagMetadata) external {
        sponsorship.flag(targetOperator, flagMetadata);
    }

    function voteOnFlag(Sponsorship sponsorship, address targetOperator, bytes32 voteData) external {
        sponsorship.voteOnFlag(targetOperator, voteData);
    }

    function onTokenTransfer(address, uint256, bytes calldata) public pure {
        // reverts here but try catch from sponsorship silently swallows it
        revert("onTokenTransfer failed");
    }

    function onKick(uint) public pure override {
        // reverts here but try catch from sponsorship silently swallows it
        revert("TestBadOperator.onKick: revert");
    }

    function onSlash(uint) public pure override {
        // reverts here but try catch from sponsorship silently swallows it
        revert("TestBadOperator.onSlash: revert");
    }

    function onReviewRequest(address) public view {
        if (shouldRevertOnReviewRequest) {
            revert("onReviewRequest: revert");
        }
    }

    // OperatorFactory will call: setUndelegationPolicy, setDelegationPolicy, setExchangeRatePolicy, renounceRole
    fallback() external { }
}
