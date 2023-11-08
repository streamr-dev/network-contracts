// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// callbacks supported by the Sponsorship, for operator smart contracts (Operator)
interface IOperator {
    /** @param slashingWei how much was taken from the operator's stake */
    function onSlash(uint slashingWei) external;

    /** @param payoutWei how much the Operator received from the forced withdraw+unstaking (minus slashing or forfeited stake) */
    function onKick(uint payoutWei) external;
}
