// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../SponsorshipPolicies/IKickPolicy.sol";
import "../Sponsorship.sol";

// import "hardhat/console.sol";

contract TestKickPolicy is IKickPolicy, Sponsorship {

    function setParam(uint _param) external {

    }

    function onFlag(address operator) external {
        _slash(operator, 10 ether);
    }

    function onVote(address operator, bytes32 voteData) external {
        _kick(operator, uint(voteData));
    }

    function getFlagData(address operator) override external view returns (uint flagData) {
        return operator.balance;
    }
}
