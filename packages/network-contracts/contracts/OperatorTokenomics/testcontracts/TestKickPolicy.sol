// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../SponsorshipPolicies/IKickPolicy.sol";
import "../Sponsorship.sol";

// import "hardhat/console.sol";

contract TestKickPolicy is IKickPolicy, Sponsorship {

    function setParam(uint256 _param) external {
    }

    function onFlag(address broker) external {
        // console.log("onflag");
        _slash(broker, 10 ether);
    }

    function onVote(address broker, bytes32 voteData) external {
        // console.log("onvote");
        _kick(broker, uint(voteData));
    }

    function getFlagData(address broker) override external view returns (uint flagData) {
        return broker.balance;
    }
}
