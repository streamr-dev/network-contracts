// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../Sponsorship.sol";

interface IStakeModule {
    function stake(Sponsorship sponsorship, uint amountWei) external;
    function reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) external;
    function reduceStakeWithoutQueue(Sponsorship sponsorship, uint targetStakeWei) external;
    function unstake(Sponsorship sponsorship) external;
    function unstakeWithoutQueue(Sponsorship sponsorship) external;
    function forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external;
    // function _removeSponsorship(Sponsorship sponsorship, uint receivedDuringUnstakingWei) private {
    function onKick(uint, uint receivedPayoutWei) external;
    function _handleProfit(uint earningsDataWei, uint operatorsCutSplitFraction, address operatorsCutSplitRecipient) external;
    function withdrawEarningsFromSponsorships(Sponsorship[] memory sponsorshipAddresses) external;
    function withdrawEarningsFromSponsorshipsWithoutQueue(Sponsorship[] memory sponsorshipAddresses) external;

}