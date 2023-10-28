// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IQueueModule.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract QueueModule is IQueueModule, Operator {

    /** Add the request to undelegate into the undelegation queue */
    function _undelegate(uint amountDataWei, address undelegator) public {
        if (amountDataWei == 0) { // TODO: should there be minimum undelegation amount?
            revert ZeroUndelegation();
        }

        // check if the undelegation policy allows this undelegation
        // this check must happen here because payOutQueue can't be allowed to fail
        if (address(undelegationPolicy) != address(0)) {
            moduleCall(address(undelegationPolicy), abi.encodeWithSelector(undelegationPolicy.onUndelegate.selector, undelegator, amountDataWei));
        }

        queueEntryAt[queueLastIndex] = UndelegationQueueEntry(undelegator, amountDataWei, block.timestamp); // solhint-disable-line not-rely-on-time
        emit QueuedDataPayout(undelegator, amountDataWei, queueLastIndex);
        queueLastIndex++;
        _payOutQueue(0);
    }

    /** Pay out up to maxIterations items in the queue */
    function _payOutQueue(uint maxIterations) public {
        if (maxIterations == 0) { maxIterations = 1 ether; }
        for (uint i; i < maxIterations; i++) {
            if (_payOutFirstInQueue() == 1) {
                break;
            }
        }
    }

    /**
     * Pay out the first item in the undelegation queue.
     * If this contract's DATA balance runs out, only pay the first item partially and leave it in front of the queue.
     * @return payoutComplete true if the queue is empty afterwards or funds have run out
     */
    function _payOutFirstInQueue() public returns (uint payoutComplete) {
        uint balanceDataWei = token.balanceOf(address(this));
        if (balanceDataWei == 0 || queueIsEmpty()) {
            return 1;
        }

        address delegator = queueEntryAt[queueCurrentIndex].delegator;
        uint amountDataWei = min(queueEntryAt[queueCurrentIndex].amountWei, valueWithoutEarnings());

        // Silently cap the undelegation to the amount of operator tokens the exiting delegator has,
        //   this means it's ok to add infinity DATA tokens to undelegation queue, it means "undelegate all my tokens".
        // Also, if the delegator would be left with less than minimumDelegationWei, just undelegate the whole balance (don't leave sand delegations)
        uint amountOperatorTokens = moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.operatorTokenToDataInverse.selector, amountDataWei));
        if (balanceOf(delegator) < amountOperatorTokens + streamrConfig.minimumDelegationWei()) {
            amountOperatorTokens = balanceOf(delegator);
            amountDataWei = moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.operatorTokenToData.selector, amountOperatorTokens));
        }

        // nothing to pay => pop the queue item
        if (amountDataWei == 0 || amountOperatorTokens == 0) {
            delete queueEntryAt[queueCurrentIndex];
            emit QueueUpdated(delegator, 0, queueCurrentIndex);
            queueCurrentIndex++;
            return 0;
        }

        // Pay out the whole amountDataWei if there's enough DATA, then pop the queue item
        if (balanceDataWei >= amountDataWei) {
            delete queueEntryAt[queueCurrentIndex];
            emit QueueUpdated(delegator, 0, queueCurrentIndex);
            queueCurrentIndex++;
        } else {
            // not enough DATA for full payout => all DATA tokens are paid out as a partial payment, update the item in the queue
            amountDataWei = balanceDataWei;
            amountOperatorTokens = moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.operatorTokenToDataInverse.selector, amountDataWei));

            // there's not enough DATA in the contract to pay out even one operator token wei, so stop the payouts for now, wait for more DATA to arrive
            if (amountOperatorTokens == 0) { return 1; }

            UndelegationQueueEntry memory oldEntry = queueEntryAt[queueCurrentIndex];
            uint remainingWei = oldEntry.amountWei - amountDataWei;
            queueEntryAt[queueCurrentIndex] = UndelegationQueueEntry(oldEntry.delegator, remainingWei, oldEntry.timestamp);
            emit QueueUpdated(delegator, remainingWei, queueCurrentIndex);
        }

        _burn(delegator, amountOperatorTokens);
        token.transfer(delegator, amountDataWei);
        emit Undelegated(delegator, amountDataWei);
        emit BalanceUpdate(delegator, balanceOf(delegator), totalSupply(), valueWithoutEarnings());
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));

        return token.balanceOf(address(this)) == 0 || queueIsEmpty() ? 1 : 0;
    }

    /**
     * Fisherman function: if there are too many earnings in another Operator, call them out and receive a reward
     * The reward will be re-delegated for the owner (same way as withdrawn earnings)
     * This function can only be called if there really are too many earnings in the other Operator.
     **/
    function _triggerAnotherOperatorWithdraw(address otherOperatorAddress, Sponsorship[] memory sponsorshipAddresses) public {
        uint balanceBeforeWei = token.balanceOf(address(this));
        Operator(otherOperatorAddress).withdrawEarningsFromSponsorships(sponsorshipAddresses);
        uint balanceAfterWei = token.balanceOf(address(this));
        uint earnings = balanceAfterWei - balanceBeforeWei;
        if (earnings == 0) {
            revert DidNotReceiveReward();
        }
        // new DATA tokens are still unaccounted, put to self-delegation instead of Profit === mint new tokens
        _delegate(owner, earnings);
    }
}
