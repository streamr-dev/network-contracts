// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "../IERC677.sol";
import "../IERC677Receiver.sol";
import "../Sponsorship.sol";

contract TestBadOperator is IERC677Receiver {
    function getMyStake(Sponsorship sponsorship) public view returns (uint) {
        return sponsorship.getMyStake();
    }

    function stake(Sponsorship sponsorship, uint amountWei, address token) public {
        IERC677(token).approve(address(sponsorship), amountWei);
        sponsorship.stake(address(this), amountWei);
    }

    function unstake(Sponsorship sponsorship) public {
        sponsorship.unstake();
    }

    function onTokenTransfer(address, uint256, bytes calldata) public pure {
        // reverts here but try catch from sponsorship silently swallows it
        revert("TestTokenReceiver.onTokenTransfer: revert");
    }
}
