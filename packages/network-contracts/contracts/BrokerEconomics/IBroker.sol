// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// callbacks supported by the Bounty, for broker smart contracts
interface IBroker {
    function onSlash() external;
    function onKick() external;
}
