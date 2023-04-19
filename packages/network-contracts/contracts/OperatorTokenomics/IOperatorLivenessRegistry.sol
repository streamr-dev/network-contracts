// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// Operator announces it's live or non-live
interface IOperatorLivenessRegistry {
    function registerAsLive() external;
    function registerAsNotLive() external;
}
