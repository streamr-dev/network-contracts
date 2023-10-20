// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IDelegationPolicy.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract DefaultDelegationPolicy is IDelegationPolicy, Operator {

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IDelegationPolicy).interfaceId;
    }

    function setParam(uint param) external {

    }

    /**
     * Check the operator's self-delegation fraction i.e. how much of the Operator token supply does the operator have as "skin in the game"
     * @dev Consequences of the minimum-self-delegation rule:
     * @dev - the first delegation must be self-delegation since at first balance(owner) == 0
     * @dev - if minimumSelfDelegationFraction == 0, then any delegations are fine, AS LONG AS the owner has some tokens
     * @param delegator The address of the delegator
     */
    function onDelegate(address delegator) external {
        // owner can always add delegation, even if for some reason the self-delegation requirement is violated (possibly the limit was changed)
        if (delegator == owner) { return; }

        // multiplying the left side by 1 ether is equivalent to dividing the right side by 1 ether, but numerically a lot better
        require(1 ether * balanceOf(owner) > totalSupply() * streamrConfig.minimumSelfDelegationFraction(), "error_selfDelegationTooLow");
    }
}
