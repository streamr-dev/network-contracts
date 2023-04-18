// SPDX-License-Identifier: MIT
/* solhint-disable reason-string */

pragma solidity ^0.8.13;

import "../SponsorshipPolicies/IJoinPolicy.sol";
import "../Sponsorship.sol";

contract TestJoinPolicy is IJoinPolicy, Sponsorship {

    function setParam(uint256 minimumStake) external pure {
        if (minimumStake == 1) {
            require(false, "test-error: setting param join policy");
        } else if (minimumStake == 2) {
            require(false);
        }
    }

    // solc-ignore-next-line func-mutability
    function onJoin(address, uint256 amount) external {
        if (amount == 1) {
            require(false, "test-error: onJoin join policy");
        } else if (amount == 2) {
            require(false);
        }
    }
}
