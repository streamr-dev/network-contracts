// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IQueueModule {
    function _payOutQueueWithFreeFunds(uint maxIterations) external;
    function _payOutFirstInQueue() external returns (uint payoutComplete);
}