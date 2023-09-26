// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IStakeModule.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract StakeModule is IStakeModule, Operator {
    /**
     * Stake DATA tokens from this contract's DATA balance into Sponsorships.
     * Can only happen if all the delegators who want to undelegate have been paid out first.
     * This means the operator must clear the queue as part of normal operation before they can change staking allocations.
     **/
    function _stake(Sponsorship sponsorship, uint amountWei) external onlyOperator {
        if(SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(address(sponsorship)) == 0) {
            revert AccessDeniedStreamrSponsorshipOnly();
        }
        if (!queueIsEmpty()) {
            revert FirstEmptyQueueThenStake();
        }
        token.approve(address(sponsorship), amountWei);
        sponsorship.stake(address(this), amountWei); // may fail if amountWei < minimumStake
        stakedInto[sponsorship] += amountWei;
        totalStakedIntoSponsorshipsWei += amountWei;
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));

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
        reduceStakeWithoutQueue(sponsorship, targetStakeWei);
        payOutQueue(0);
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
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }


    /**
     * Unstake from a sponsorship
     * Throws if some of the stake is locked to pay for flags (being flagged or flagging others)
     **/
    function _unstake(Sponsorship sponsorship) public onlyOperator {
        unstakeWithoutQueue(sponsorship);
        payOutQueue(0);
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
     * Operator can also call this, if they want to forfeit the stake locked to flagging in a sponsorship (normal unstake would revert for safety)
     * @param sponsorship the funds (unstake) to pay out the queue
     * @param maxQueuePayoutIterations how many queue items to pay out, see getMyQueuePosition()
     */
    function _forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external {
        // onlyOperator check happens only if grace period hasn't passed yet
        if (block.timestamp < undelegationQueue[queueCurrentIndex].timestamp + streamrConfig.maxQueueSeconds() && !hasRole(CONTROLLER_ROLE, _msgSender())) { // solhint-disable-line not-rely-on-time
            revert AccessDeniedOperatorOnly();
        }

        uint balanceBeforeWei = token.balanceOf(address(this));
        sponsorship.forceUnstake();
        _removeSponsorship(sponsorship, token.balanceOf(address(this)) - balanceBeforeWei);
        payOutQueue(maxQueuePayoutIterations);
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
            emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
        } else {
            uint profitDataWei = receivedDuringUnstakingWei - stakedInto[sponsorship];
            _splitEarnings(profitDataWei, slashedIn[sponsorship], 0, address(0)); // 0 = no fisherman who would claim part of the operator's cut
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
     * Whenever earnings from Sponsorships come in, split them as follows:
     *  1) to protocol: send out protocolFeeFraction * earnings as protocol fee, and then
     *  2) to delegators: leave (earnings - protocol fee - operator's cut) to this contract's DATA balance as profit, inflating the operator token value, and finally
     *  3) to operator: leave operatorsCutFraction * (earnings - protocol fee) to this contract's DATA balance as operator's cut,
     *     paid in self-delegation (by minting operator tokens to Operator); EXCEPT if Operator got slashed, in which case operator's cut is first depleted to pay for it.
     * If the operator is penalized for too much earnings, a fraction will be deducted from the operator's cut and sent to the fisherman
     * @param earningsDataWei received DATA tokens to be processed
     * @param fishermansFraction fraction of the operator's cut that is sent NOT to the operator but to the fisherman
     * @param fisherman address is non-zero if the operator is penalized for too much earnings, otherwise `address(0)`
     **/
    function _splitEarnings(uint earningsDataWei, uint slashedDataWei, uint fishermansFraction, address fisherman) public {
        uint earningsWithoutSlashing = earningsDataWei + slashedDataWei;
        uint protocolFee = earningsWithoutSlashing * streamrConfig.protocolFeeFraction() / 1 ether;
        token.transfer(streamrConfig.protocolFeeBeneficiary(), protocolFee);

        uint operatorsCut = (earningsWithoutSlashing - protocolFee) * operatorsCutFraction / 1 ether;

        // send out part of the operator's cut as a reward for withdrawing the overdue earnings
        uint fishermansReward = 0;
        if (fishermansFraction > 0) {
            fishermansReward = operatorsCut * fishermansFraction / 1 ether;
            token.transfer(fisherman, fishermansReward);
            operatorsCut -= fishermansReward;
        }

        // operator only gets their cut after they first pay for all the past slashings
        if (operatorsCut > unpaidSlashings) {
            operatorsCut -= unpaidSlashings;
            unpaidSlashings = 0;

            // "self-delegate" the operator's share === mint new operator tokens
            // because _delegate is assumed to be called AFTER the DATA token transfer, the result of calling it is equivalent to:
            //  1) send operator's cut in DATA tokens to the operator (removed from DATA balance, NO burning of tokens)
            //  2) the operator delegates them back to the contract (added back to DATA balance, minting new tokens)
            _delegate(owner, operatorsCut);
        } else {
            unpaidSlashings -= operatorsCut;
            operatorsCut = 0;
        }

        // the rest just goes to the Operator contract's DATA balance, inflating the Operator token value, and so is counted as Profit
        emit Profit(earningsDataWei - protocolFee - fishermansReward - operatorsCut, operatorsCut, protocolFee);
    }


    /**
     * If the sum of accumulated earnings over all staked Sponsorships (includes operator's share of the earnings) becomes too large,
     *   then anyone can call this method and point out a set of sponsorships where earnings together sum up to maxAllowedEarningsFraction.
     * Caller gets fishermanRewardFraction of the operator's earnings share as a reward, if they provide that set of sponsorships.
     */
    function _withdrawEarningsFromSponsorships(Sponsorship[] memory sponsorships) public {
        withdrawEarningsFromSponsorshipsWithoutQueue(sponsorships);
        payOutQueue(0);
    }

    /** In case the queue is very long (e.g. due to spamming), give the operator an option to free funds from Sponsorships to pay out the queue in parts */
    function _withdrawEarningsFromSponsorshipsWithoutQueue(Sponsorship[] memory sponsorships) public {
        uint valueBeforeWithdraw = valueWithoutEarnings();

        uint sumEarnings = 0;
        for (uint i = 0; i < sponsorships.length; i++) {
            sumEarnings += sponsorships[i].withdraw(); // this contract receives DATA tokens
        }
        if (sumEarnings == 0) {
            revert NoEarnings();
        }

        // if the caller is an outsider ("fisherman"), and if sum of earnings are more than allowed, then give part of the operator's cut to them as a reward
        address fisherman = address(0);
        uint fishermansFraction = 0;
        if (!hasRole(CONTROLLER_ROLE, _msgSender()) && nodeIndex[_msgSender()] == 0) {
            uint allowedDifference = valueBeforeWithdraw * streamrConfig.maxAllowedEarningsFraction() / 1 ether;
            if (sumEarnings > allowedDifference) {
                fisherman = _msgSender();
                fishermansFraction = streamrConfig.fishermanRewardFraction();
            }
        }
        _splitEarnings(sumEarnings, 0, fishermansFraction, fisherman); // 0 = no slashing can happen during withdraw
    }
}
