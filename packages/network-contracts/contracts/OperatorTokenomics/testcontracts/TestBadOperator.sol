// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "../IERC677.sol";
import "../IERC677Receiver.sol";
import "../Sponsorship.sol";
import "../IOperator.sol";

/** This operator tries to prevent Sponsorship from working by reverting in callbacks */
contract TestBadOperator is IERC677Receiver, IOperator {
    function stake(Sponsorship sponsorship, uint amountWei, address token) public {
        IERC677(token).approve(address(sponsorship), amountWei);
        sponsorship.stake(address(this), amountWei);
    }

    function unstake(Sponsorship sponsorship) public {
        sponsorship.unstake();
    }

    function onTokenTransfer(address, uint256, bytes calldata) public pure {
        // reverts here but try catch from sponsorship silently swallows it
        revert("onTokenTransfer failed");
    }

    function onKick(uint, uint) public pure override {
        // reverts here but try catch from sponsorship silently swallows it
        revert("TestBadOperator.onKick: revert");
    }

    function onSlash(uint) public pure override {
        // reverts here but try catch from sponsorship silently swallows it
        revert("TestBadOperator.onSlash: revert");
    }
}
