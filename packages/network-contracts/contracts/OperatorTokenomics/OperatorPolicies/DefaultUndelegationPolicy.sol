// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IUndelegationPolicy.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract DefaultUndelegationPolicy is IUndelegationPolicy, Operator {

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IUndelegationPolicy).interfaceId;
    }

    function setParam(uint) external {

    }

    /**
     * Check the operator's self-undelegation limit i.e. how much of the Operator token supply does the operator have as "skin in the game".
     * For others, it's always OK to undelegate.
     * After self-undelegation, operator must still hold at least minimumSelfDelegationFraction of the total supply.
     * @dev NOTE that amount can be anything, including more than the actual operator token balance
     * @dev Consequence of this limit: if there's lots of undelegation queue, those tokens still count for the totalSupply.
     * @dev This means if the queue is left un-serviced, the operator's effective self-delegation limit is higher.
     **/
    function onUndelegate(address delegator, uint amount) external {
        // limitation only applies to the operator, others can always undelegate
        if (delegator != owner) { return; }

        uint actualAmount = amount < balanceOf(owner) ? amount : balanceOf(owner);
        uint balanceAfter = balanceOf(owner) - actualAmount;
        uint totalSupplyAfter = totalSupply() - actualAmount;
        require(1 ether * balanceAfter >= totalSupplyAfter * streamrConfig.minimumSelfDelegationFraction(), "error_selfDelegationTooLow");
    }
}
