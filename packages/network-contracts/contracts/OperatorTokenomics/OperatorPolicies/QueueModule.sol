// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IQueueModule.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract QueueModule is IQueueModule, Operator {

    /**
     * Get the position of the LAST undelegation request in the queue for the given delegator.
     * Answers the question 'how many queue positions must (still) be paid out before I get (all) my queued tokens?'
     *   for the purposes of "self-service undelegation" (forceUnstake or payOutQueueWithFreeFunds)
     * If delegator is not in the queue, returns just the length of the queue + 1 (i.e. the position they'd get if they undelegate now)
     */
    function _queuePositionOf(address delegator) external view returns (uint) {
        for (uint i = queueLastIndex - 1; i >= queueCurrentIndex; i--) {
            if (undelegationQueue[i].delegator == delegator) {
                return i - queueCurrentIndex + 1;
            }
        }
        return queueLastIndex - queueCurrentIndex + 1;
    }

    /** Pay out up to maxIterations items in the queue */
    function _payOutQueueWithFreeFunds(uint maxIterations) public {
        if (maxIterations == 0) { maxIterations = 1 ether; }
        for (uint i = 0; i < maxIterations; i++) {
            if (payOutFirstInQueue()) {
                break;
            }
        }
    }

    /**
     * Pay out the first item in the undelegation queue.
     * If free funds run out, only pay the first item partially and leave it in front of the queue.
     * @return payoutComplete true if the queue is empty afterwards or funds have run out
     */
    function _payOutFirstInQueue() public returns (bool payoutComplete) {
        uint balanceDataWei = token.balanceOf(address(this));
        if (balanceDataWei == 0 || queueIsEmpty()) {
            return true;
        }

        // Take the first element from the queue, and silently cap it to the amount of pool tokens the exiting delegator has,
        //   this means it's ok to add infinity tokens to undelegation queue, it means "undelegate all my tokens".
        // Also, if the delegator would be left with less than minimumDelegationWei, just undelegate the whole balance (don't leave sand delegations)
        address delegator = undelegationQueue[queueCurrentIndex].delegator;
        uint amountPoolTokens = undelegationQueue[queueCurrentIndex].amountPoolTokenWei;
        if (balanceOf(delegator) < amountPoolTokens + streamrConfig.minimumDelegationWei()) {
            amountPoolTokens = balanceOf(delegator);
        }

        // nothing to pay => pop the queue item
        if (amountPoolTokens == 0) {
            delete undelegationQueue[queueCurrentIndex];
            emit QueueUpdated(delegator, 0, queueCurrentIndex);
            queueCurrentIndex++;
            return false;
        }

        // convert to DATA and see if we have enough free funds to pay out the queue item in full
        uint amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            amountPoolTokens, 0), "error_yieldPolicy_pooltokenToData_Failed");
        if (balanceDataWei >= amountDataWei) {
            // enough DATA for payout => whole amountDataWei is paid out => pop the queue item
            delete undelegationQueue[queueCurrentIndex];
            emit QueueUpdated(delegator, 0, queueCurrentIndex);
            queueCurrentIndex++;
        } else {
            // not enough DATA for full payout => all free funds are paid out as a partial payment, update the item in the queue
            amountDataWei = balanceDataWei;
            amountPoolTokens = moduleCall(address(yieldPolicy),
                abi.encodeWithSelector(yieldPolicy.dataToPooltoken.selector,
                amountDataWei, 0), "error_dataToPooltokenFailed"
            );
            UndelegationQueueEntry memory oldEntry = undelegationQueue[queueCurrentIndex];
            uint poolTokensLeftInQueue = oldEntry.amountPoolTokenWei - amountPoolTokens;
            undelegationQueue[queueCurrentIndex] = UndelegationQueueEntry(oldEntry.delegator, poolTokensLeftInQueue, oldEntry.timestamp);
            emit QueueUpdated(delegator, poolTokensLeftInQueue, queueCurrentIndex);
        }

        // console.log("payOutFirstInQueue: pool tokens", amountPoolTokens, "DATA", amountDataWei);
        _burn(delegator, amountPoolTokens);
        token.transfer(delegator, amountDataWei);
        emit Undelegated(delegator, amountDataWei);
        emit BalanceUpdate(delegator, balanceOf(delegator), totalSupply());
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));

        return token.balanceOf(address(this)) == 0 || queueIsEmpty();
    }
}
