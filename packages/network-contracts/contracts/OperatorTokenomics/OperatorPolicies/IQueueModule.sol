// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../Sponsorship.sol";

interface IQueueModule {
    function _undelegate(uint amountWei, address undelegator) external;
    function _payOutQueue(uint maxIterations) external;
    function _payOutFirstInQueue() external returns (uint payoutComplete);
    function _triggerAnotherOperatorWithdraw(address other, Sponsorship[] memory sponsorshipAddresses) external;
}