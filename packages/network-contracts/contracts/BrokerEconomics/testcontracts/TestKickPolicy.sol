// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../BountyPolicies/IKickPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract TestKickPolicy is IKickPolicy, Bounty {

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
