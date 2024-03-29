// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IStakeModule.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract StakeModule is IStakeModule, Operator {

    /** Stake DATA tokens from this contract's DATA balance into Sponsorships. */
    function _stake(Sponsorship sponsorship, uint amountWei) external {
        if (SponsorshipFactory(streamrConfig.sponsorshipFactory()).deploymentTimestamp(address(sponsorship)) == 0) {
            revert AccessDeniedStreamrSponsorshipOnly();
        }
        if (!queueIsEmpty()) {
            revert FirstEmptyQueueThenStake();
        }
        if (balanceOf(owner) * 1 ether <= totalSupply() * streamrConfig.minimumSelfDelegationFraction()) {
            revert SelfDelegationTooLow(balanceOf(owner), totalSupply() * streamrConfig.minimumSelfDelegationFraction() / 1 ether);
        }

        token.approve(address(sponsorship), amountWei);
        sponsorship.stake(address(this), amountWei); // may fail if amountWei < minimumStake
        stakedInto[sponsorship] += amountWei;
        totalStakedIntoSponsorshipsWei += amountWei;

        if (indexOfSponsorships[sponsorship] == 0) { // initial staking in a new sponsorship
            sponsorships.push(sponsorship);
            indexOfSponsorships[sponsorship] = sponsorships.length; // real array index + 1
            emit Staked(sponsorship);
        }

        IVoterRegistry(streamrConfig.voterRegistry()).voterUpdate(address(this));
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    function _reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) public {
        if (targetStakeWei == 0) {
            _unstake(sponsorship);
            return;
        }
        uint cashoutWei = sponsorship.reduceStakeTo(targetStakeWei);
        stakedInto[sponsorship] -= cashoutWei;
        totalStakedIntoSponsorshipsWei -= cashoutWei;
        IVoterRegistry(streamrConfig.voterRegistry()).voterUpdate(address(this));
        emit StakeUpdate(sponsorship, stakedInto[sponsorship] - slashedIn[sponsorship]);
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    function _unstake(Sponsorship sponsorship) public {
        uint balanceBeforeWei = token.balanceOf(address(this));
        sponsorship.unstake();
        _removeSponsorship(sponsorship, token.balanceOf(address(this)) - balanceBeforeWei);
    }

    /**
     * Self-service undelegation queue handling.
     * If the operator hasn't been doing its job, and the undelegation queue hasn't been paid out,
     *   anyone can come along and forceUnstake from a sponsorship to get the payouts rolling
     * Operator can also call this, if they want to forfeit the stake locked to flagging in a sponsorship (normal unstake would revert for safety)
     * @param sponsorship the funds (unstake) to pay out the queue
     */
    function _forceUnstake(Sponsorship sponsorship) external {
        uint balanceBeforeWei = token.balanceOf(address(this));
        sponsorship.forceUnstake();
        _removeSponsorship(sponsorship, token.balanceOf(address(this)) - balanceBeforeWei);
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
        } else {
            uint profitDataWei = receivedDuringUnstakingWei - stakedInto[sponsorship];
            _splitEarnings(profitDataWei);
        }

        IVoterRegistry(streamrConfig.voterRegistry()).voterUpdate(address(this));

        // remove from array: replace with the last element
        uint index = indexOfSponsorships[sponsorship] - 1; // indexOfSponsorships is the real array index + 1
        Sponsorship lastSponsorship = sponsorships[sponsorships.length - 1];
        sponsorships[index] = lastSponsorship;
        sponsorships.pop();
        indexOfSponsorships[lastSponsorship] = index + 1; // indexOfSponsorships is the real array index + 1
        delete indexOfSponsorships[sponsorship];

        // remove from stake/slashing tracking
        stakedInto[sponsorship] = 0;
        slashedIn[sponsorship] = 0;
        emit Unstaked(sponsorship);
        emit StakeUpdate(sponsorship, 0);
        emit OperatorValueUpdate(totalStakedIntoSponsorshipsWei - totalSlashedInSponsorshipsWei, token.balanceOf(address(this)));
    }

    /** @dev this is in stakeModule because it calls _splitEarnings */
    function _withdrawEarnings(Sponsorship[] memory sponsorshipAddresses) public returns (uint sumEarnings) {
        for (uint i; i < sponsorshipAddresses.length; i++) {
            sumEarnings += sponsorshipAddresses[i].withdraw(); // this contract receives DATA tokens
        }
        if (sumEarnings == 0) {
            revert NoEarnings();
        }
        _splitEarnings(sumEarnings);
    }

    /**
     * Whenever earnings from Sponsorships come in, split them as follows:
     *  1) to protocol: send out protocolFeeFraction * earnings as protocol fee, and then
     *  2) to delegators: leave (earnings - protocol fee - operator's cut) to this contract's DATA balance as profit, inflating the operator token value, and finally
     *  3) to operator: leave operatorsCutFraction * (earnings - protocol fee) to this contract's DATA balance as operator's cut,
     *                  paid in self-delegation (by minting operator tokens to Operator)
     * @param earningsDataWei income to be processed, in DATA
     **/
    function _splitEarnings(uint earningsDataWei) public {
        uint protocolFee = earningsDataWei * streamrConfig.protocolFeeFraction() / 1 ether;
        token.transfer(streamrConfig.protocolFeeBeneficiary(), protocolFee);

        // "self-delegate" the operator's share === mint new operator tokens
        // because _delegate is assumed to be called AFTER the DATA token transfer, the result of calling it is equivalent to:
        //  1) send operator's cut in DATA tokens to the operator (removed from DATA balance, NO burning of tokens)
        //  2) the operator delegates them back to the contract (added back to DATA balance, minting new tokens)
        uint operatorsCutDataWei = (earningsDataWei - protocolFee) * operatorsCutFraction / 1 ether;
        _delegate(owner, operatorsCutDataWei);

        // the rest just goes to the Operator contract's DATA balance, inflating the Operator token value, and so is counted as Profit
        emit Profit(earningsDataWei - protocolFee - operatorsCutDataWei, operatorsCutDataWei, protocolFee);
    }
}
