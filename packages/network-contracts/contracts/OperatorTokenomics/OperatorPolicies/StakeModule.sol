// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IStakeModule.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract StakeModule is IStakeModule, Operator {

    /////////////////////////////////////////
    // OPERATOR FUNCTIONS: STAKE MANAGEMENT
    /////////////////////////////////////////

    /**
     * Stake DATA tokens from free funds into Sponsorships.
     * Can only happen if all the delegators who want to undelegate have been paid out first.
     * This means the operator must clear the queue as part of normal operation before they can change staking allocations.
     **/
    function _stake(Sponsorship sponsorship, uint amountWei) external onlyOperator {
        require(SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(address(sponsorship)) > 0, "error_badSponsorship");
        require(queueIsEmpty(), "error_firstEmptyQueueThenStake");
        token.approve(address(sponsorship), amountWei);
        sponsorship.stake(address(this), amountWei); // may fail if amountWei < minimumStake
        stakedInto[sponsorship] += amountWei;
        totalStakedIntoSponsorshipsWei += amountWei;
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));

        if (indexOfSponsorships[sponsorship] == 0) { // initial staking in a new sponsorship
            sponsorships.push(sponsorship);
            indexOfSponsorships[sponsorship] = sponsorships.length; // real array index + 1
            if (sponsorships.length == 1) {
                try IOperatorLivenessRegistry(streamrConfig.operatorLivenessRegistry()).registerAsLive() {} catch {}
            }
            emit Staked(sponsorship);
        }
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
    }

    /**
     * Take out some of the stake from a sponsorship without completely unstaking
     * Except if you call this with targetStakeWei == 0, then it will actually call unstake
     **/
    function _reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) external onlyOperator {
        // console.log("## reduceStake amountWei", amountWei);
        reduceStakeWithoutQueue(sponsorship, targetStakeWei);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function _reduceStakeWithoutQueue(Sponsorship sponsorship, uint targetStakeWei) public onlyOperator {
        if (targetStakeWei == 0) {
            unstakeWithoutQueue(sponsorship);
            return;
        }
        uint cashoutWei = sponsorship.reduceStakeTo(targetStakeWei);
        stakedInto[sponsorship] -= cashoutWei;
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
        totalStakedIntoSponsorshipsWei -= cashoutWei;
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }


    /**
     * Unstake from a sponsorship
     * Throws if some of the stake is committed to a flag (being flagged or flagging others)
     **/
    function _unstake(Sponsorship sponsorship) public onlyOperator {
        unstakeWithoutQueue(sponsorship);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function _unstakeWithoutQueue(Sponsorship sponsorship) public onlyOperator {
        uint balanceBeforeWei = token.balanceOf(address(this));
        sponsorship.unstake();
        _removeSponsorship(sponsorship, token.balanceOf(address(this)) - balanceBeforeWei);
    }

    /**
     * Self-service undelegation queue handling.
     * If the operator hasn't been doing its job, and undelegationQueue hasn't been paid out,
     *   anyone can come along and forceUnstake from a sponsorship to get the payouts rolling
     * Operator can also call this, if they want to forfeit the stake committed to flagging in a sponsorship (normal unstake would revert for safety)
     * @param sponsorship the funds (unstake) to pay out the queue
     * @param maxQueuePayoutIterations how many queue items to pay out, see getMyQueuePosition()
     */
    function _forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external {
        // onlyOperator check happens only if grace period hasn't passed yet
        if (block.timestamp < undelegationQueue[queueCurrentIndex].timestamp + streamrConfig.maxQueueSeconds()) { // solhint-disable-line not-rely-on-time
            require(hasRole(CONTROLLER_ROLE, _msgSender()), "error_accessDeniedOperatorOnly");
        }

        uint balanceBeforeWei = token.balanceOf(address(this));
        sponsorship.forceUnstake();
        _removeSponsorship(sponsorship, token.balanceOf(address(this)) - balanceBeforeWei);
        payOutQueueWithFreeFunds(maxQueuePayoutIterations);
    }

    /**
     * Remove a Sponsorship from bookkeeping - either we unstaked from it or got kicked out.
     * Also calculate the Profit/Loss from that investment at this point.
     * Earnings were mixed together with stake in the unstaking process; only earnings on top of what has been staked is emitted in Profit event.
     * This means whatever was slashed gets also deducted from the operator's share
     */
    function _removeSponsorship(Sponsorship sponsorship, uint receivedDuringUnstakingWei) public {
        totalStakedIntoSponsorshipsWei -= stakedInto[sponsorship];
        totalSlashedInSponsorshipsWei -= slashedIn[sponsorship];

        if (receivedDuringUnstakingWei < stakedInto[sponsorship]) {
            uint lossWei = stakedInto[sponsorship] - receivedDuringUnstakingWei;
            emit Loss(lossWei);
            emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
        } else {
            uint profitDataWei = receivedDuringUnstakingWei - stakedInto[sponsorship];
            _handleProfit(profitDataWei, 0, address(0));
        }

        // remove from array: replace with the last element
        uint index = indexOfSponsorships[sponsorship] - 1; // indexOfSponsorships is the real array index + 1
        Sponsorship lastSponsorship = sponsorships[sponsorships.length - 1];
        sponsorships[index] = lastSponsorship;
        sponsorships.pop();
        indexOfSponsorships[lastSponsorship] = index + 1; // indexOfSponsorships is the real array index + 1
        delete indexOfSponsorships[sponsorship];
        if (sponsorships.length == 0) {
            try IOperatorLivenessRegistry(streamrConfig.operatorLivenessRegistry()).registerAsNotLive() {} catch {}
        }

        // remove from stake/slashing tracking
        stakedInto[sponsorship] = 0;
        slashedIn[sponsorship] = 0;
        emit Unstaked(sponsorship);
        emit StakeUpdate(sponsorship, 0);
    }

        /**
     * Whenever profit (earnings from Sponsorships) comes in,
     *  pay part of it as protocol fee, and then
     *  pay part of it to the Operator by minting pool tokens
     * If the operator is penalized for too much unwithdrawn earnings, a fraction will be deducted from the operator's cut and sent to operatorsCutSplitRecipient
     * @param earningsDataWei income to be processed, in DATA
     * @param operatorsCutSplitFraction fraction of the operator's cut that is sent NOT to the operator but to the operatorsCutSplitRecipient
     * @param operatorsCutSplitRecipient non-zero if the operator is penalized for too much unwithdrawn earnings, otherwise `address(0)`
     **/
    function _handleProfit(uint earningsDataWei, uint operatorsCutSplitFraction, address operatorsCutSplitRecipient) public {
        uint protocolFee = earningsDataWei * streamrConfig.protocolFeeFraction() / 1 ether;
        token.transfer(streamrConfig.protocolFeeBeneficiary(), protocolFee);

        uint operatorsCutDataWei = (earningsDataWei - protocolFee) * operatorsCutFraction / 1 ether;

        uint operatorPenaltyDataWei = 0;
        if (operatorsCutSplitFraction > 0) {
            operatorPenaltyDataWei = operatorsCutDataWei * operatorsCutSplitFraction / 1 ether;
            token.transfer(operatorsCutSplitRecipient, operatorPenaltyDataWei);
        }

        // "self-delegate" the operator's share === mint new pooltokens
        _mintPoolTokensFor(owner, operatorsCutDataWei - operatorPenaltyDataWei);

        // the rest is added to free funds, inflating the pool token value, and counted as Profit
        emit Profit(earningsDataWei - protocolFee - operatorsCutDataWei, operatorsCutDataWei - operatorPenaltyDataWei, protocolFee);
        emit PoolValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }


    /**
     * If the sum of accumulated earnings over all staked Sponsorships (includes operator's share of the earnings) becomes too large,
     *   then anyone can call this method and point out a set of sponsorships where earnings together sum up to poolValueDriftLimitFraction.
     * Caller gets poolValueDriftPenaltyFraction of the operator's earnings share as a reward, if they provide that set of sponsorships.
     */
    function _withdrawEarningsFromSponsorships(Sponsorship[] memory sponsorshipAddresses) public {
        withdrawEarningsFromSponsorshipsWithoutQueue(sponsorshipAddresses);
        payOutQueueWithFreeFunds(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function _withdrawEarningsFromSponsorshipsWithoutQueue(Sponsorship[] memory sponsorshipAddresses) public {
        uint poolValueBeforeWithdraw = getApproximatePoolValue();

        uint sumEarnings = 0;
        for (uint i = 0; i < sponsorshipAddresses.length; i++) {
            sumEarnings += sponsorshipAddresses[i].withdraw(); // this contract receives DATA tokens
        }
        require(sumEarnings > 0, "error_noEarnings");

        // if the caller is an outsider, and if sum of earnings are more than allowed, then give part of the operator's cut to the caller as a reward
        address penaltyRecipient = address(0);
        uint penaltyFraction = 0;
        if (!hasRole(CONTROLLER_ROLE, _msgSender()) && nodeIndex[_msgSender()] == 0) {
            uint allowedDifference = poolValueBeforeWithdraw * streamrConfig.poolValueDriftLimitFraction() / 1 ether;
            if (sumEarnings > allowedDifference) {
                penaltyRecipient = _msgSender();
                penaltyFraction = streamrConfig.poolValueDriftPenaltyFraction();
            }
        }
        _handleProfit(sumEarnings, penaltyFraction, penaltyRecipient);
    }
}
