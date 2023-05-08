// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IUndelegationPolicy.sol";
import "../Operator.sol";

contract DefaultUndelegationPolicy is IUndelegationPolicy, Operator {

    function setParam(uint256 param) external {
    }

    function onUndelegate(address delegator, uint256 amount) external {
        // TODO
    }
}