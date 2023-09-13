// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../Operator.sol";
import "../Sponsorship.sol";

interface IQueueModule {
    function _undelegate(uint amountPoolTokenWei) external;
    function _payOutQueueWithFreeFunds(uint maxIterations) external;
    function _payOutFirstInQueue() external returns (uint payoutComplete);
    function _triggerAnotherOperatorWithdraw(Operator other, Sponsorship[] memory sponsorshipAddresses) external;
}