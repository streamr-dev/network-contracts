// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IQueueModule.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract QueueModule is IQueueModule, Operator {

    /** Add the request to undelegate into the undelegation queue */
    function _undelegate(uint amountWei) public {
        if (amountWei == 0) { // TODO: should there be minimum undelegation amount?
            revert ZeroUndelegation();
        }

        address undelegator = _msgSender();

        // check if the undelegation policy allows this undelegation
        // this check must happen before payOutQueueWithFreeFunds because we can't know how much gets paid out
        if (address(undelegationPolicy) != address(0)) {
            moduleCall(address(undelegationPolicy), abi.encodeWithSelector(undelegationPolicy.onUndelegate.selector, undelegator, amountWei));
        }

        undelegationQueue[queueLastIndex] = UndelegationQueueEntry(undelegator, amountWei, block.timestamp); // solhint-disable-line not-rely-on-time
        emit QueuedDataPayout(undelegator, amountWei, queueLastIndex);
        queueLastIndex++;
        payOutQueueWithFreeFunds(0);
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
    function _payOutFirstInQueue() public returns (uint payoutComplete) {
        uint balanceDataWei = token.balanceOf(address(this));
        if (balanceDataWei == 0 || queueIsEmpty()) {
            return 1;
        }

        // Take the first element from the queue, and silently cap it to the amount of pool tokens the exiting delegator has,
        //   this means it's ok to add infinity tokens to undelegation queue, it means "undelegate all my tokens".
        // Also, if the delegator would be left with less than minimumDelegationWei, just undelegate the whole balance (don't leave sand delegations)
        address delegator = undelegationQueue[queueCurrentIndex].delegator;
        uint amountPoolTokens = undelegationQueue[queueCurrentIndex].amountWei;
        if (balanceOf(delegator) < amountPoolTokens + streamrConfig.minimumDelegationWei()) {
            amountPoolTokens = balanceOf(delegator);
        }

        // nothing to pay => pop the queue item
        if (amountPoolTokens == 0) {
            delete undelegationQueue[queueCurrentIndex];
            emit QueueUpdated(delegator, 0, queueCurrentIndex);
            queueCurrentIndex++;
            return 0;
        }

        // convert to DATA and see if we have enough free funds to pay out the queue item in full
        uint amountDataWei = moduleCall(address(yieldPolicy), abi.encodeWithSelector(yieldPolicy.pooltokenToData.selector,
            amountPoolTokens, 0));
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
                amountDataWei, 0));
            UndelegationQueueEntry memory oldEntry = undelegationQueue[queueCurrentIndex];
            uint poolTokensLeftInQueue = oldEntry.amountWei - amountPoolTokens;
            undelegationQueue[queueCurrentIndex] = UndelegationQueueEntry(oldEntry.delegator, poolTokensLeftInQueue, oldEntry.timestamp);
            emit QueueUpdated(delegator, poolTokensLeftInQueue, queueCurrentIndex);
        }

        // console.log("payOutFirstInQueue: pool tokens", amountPoolTokens, "DATA", amountDataWei);
        _burn(delegator, amountPoolTokens);
        token.transfer(delegator, amountDataWei);
        emit Undelegated(delegator, amountDataWei);
        emit BalanceUpdate(delegator, balanceOf(delegator), totalSupply());
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));

        return token.balanceOf(address(this)) == 0 || queueIsEmpty() ? 1 : 0;
    }

    /**
     * Fisherman function: if there are too many unwithdrawn earnings in another Operator, call them out and receive a reward
     * The reward will be re-delegated for the owner (same way as withdrawn earnings)
     * This function can only be called if there really are too many unwithdrawn earnings in the other Operator.
     **/
    function _triggerAnotherOperatorWithdraw(Operator other, Sponsorship[] memory sponsorshipAddresses) public {
        uint balanceBeforeWei = token.balanceOf(address(this));
        other.withdrawEarningsFromSponsorshipsWithoutQueue(sponsorshipAddresses);
        uint balanceAfterWei = token.balanceOf(address(this));
        uint earnings = balanceAfterWei - balanceBeforeWei;
        if (earnings == 0) {
            revert DidNotReceiveReward();
        }
        // new DATA tokens are still unaccounted, will go to self-delegation instead of Profit
        _mintPoolTokensFor(owner, earnings);
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, balanceAfterWei);
    }
}
