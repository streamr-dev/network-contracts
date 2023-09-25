// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../Sponsorship.sol";

interface IStakeModule {
    function _stake(Sponsorship sponsorship, uint amountWei) external;
    function _reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) external;
    function _reduceStakeWithoutQueue(Sponsorship sponsorship, uint targetStakeWei) external;
    function _unstake(Sponsorship sponsorship) external;
    function _unstakeWithoutQueue(Sponsorship sponsorship) external;
    function _forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external;
    function _removeSponsorship(Sponsorship sponsorship, uint receivedDuringUnstakingWei) external;
    function _withdrawEarningsFromSponsorships(Sponsorship[] memory sponsorshipAddresses) external;
    function _withdrawEarningsFromSponsorshipsWithoutQueue(Sponsorship[] memory sponsorshipAddresses) external;
}
