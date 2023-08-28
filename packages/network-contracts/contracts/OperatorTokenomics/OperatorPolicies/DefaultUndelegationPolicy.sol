// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IUndelegationPolicy.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract DefaultUndelegationPolicy is IUndelegationPolicy, Operator {

    function setParam(uint) external {

    }

    /**
     * Check the operator's self-delegation fraction i.e. how much of the Operator token supply does the operator have as "skin in the game".
     * For others, it's always OK to undelegate.
     * @dev Consequence of this limit: if there's lots of undelegation queue, those tokens still count for the totalSupply.
     * @dev This means that the more of the queue is serviced, the lower the operator's self-delegation can go.
     **/
    function onUndelegate(address delegator, uint amount) external {
        // limitation only applies to the operator, others can always undelegate
        if (delegator != owner) { return; }

        uint newBalance = balanceOf(owner) - amount;
        require(1 ether * newBalance >= totalSupply() * streamrConfig.minimumSelfDelegationFraction(), "error_selfDelegationTooLow");
    }
}
