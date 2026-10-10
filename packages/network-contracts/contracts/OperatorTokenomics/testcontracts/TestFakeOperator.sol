// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../../token/IERC677.sol";
import "../Operator.sol";
import "../Sponsorship.sol";

/**
 * Not an Operator (not deployed by OperatorFactory), but has the function that Operator.triggerAnotherOperatorWithdraw calls.
 * When called, it re-enters the target Operator by delegating DATA on behalf of `beneficiary`.
 * Used to test that QueueModule._triggerAnotherOperatorWithdraw does not accept arbitrary contracts as "the other Operator":
 *   otherwise the DATA delegated during the re-entry would be minted a second time, as the owner's self-delegation.
 */
contract TestFakeOperator {
    IERC677 public token;
    Operator public target;
    address public beneficiary;
    uint public amountWei;

    constructor(IERC677 token_) {
        token = token_;
    }

    function attack(Operator target_, address beneficiary_, uint amountWei_) external {
        target = target_;
        beneficiary = beneficiary_;
        amountWei = amountWei_;
        target_.triggerAnotherOperatorWithdraw(Operator(address(this)), new Sponsorship[](0));
    }

    /** Called by target's QueueModule._triggerAnotherOperatorWithdraw */
    function withdrawEarningsFromSponsorships(Sponsorship[] memory) external {
        token.transferAndCall(address(target), amountWei, abi.encodePacked(beneficiary));
    }
}
