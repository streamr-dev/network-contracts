// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// callbacks supported by the Sponsorship, for operator smart contracts (Operator)
interface IOperator {
    function onSlash() external;
    function onKick() external;
}
