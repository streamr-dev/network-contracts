// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../Sponsorship.sol";

interface IStakeModule {
    function _stake(Sponsorship sponsorship, uint amountWei) external;
    function _reduceStakeTo(Sponsorship sponsorship, uint targetStakeWei) external;
    function _unstake(Sponsorship sponsorship) external;
    function _forceUnstake(Sponsorship sponsorship, uint maxQueuePayoutIterations) external;
    function _removeSponsorship(Sponsorship sponsorship, uint receivedDuringUnstakingWei) external;
    function _withdrawEarnings(Sponsorship[] memory sponsorshipAddresses) external returns (uint sumEarnings);
}
