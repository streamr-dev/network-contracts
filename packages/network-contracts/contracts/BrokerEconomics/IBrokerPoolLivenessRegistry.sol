// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// BrokerPool announces it's live or non-live
interface IBrokerPoolLivenessRegistry {
    function registerAsLive() external;
    function registerAsNotLive() external;
}
