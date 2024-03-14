// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../SponsorshipPolicies/IKickPolicy.sol";
import "../Sponsorship.sol";

contract TestKickPolicy is IKickPolicy, Sponsorship {

    function setParam(uint _param) external {

    }

    function onFlag(address operator, address) external {
        uint actualSlashingWei = _slash(operator, 10 ether);
        _addSponsorship(address(this), actualSlashingWei);
    }

    function onVote(address operator, bytes32 voteData, address) external {
        uint actualSlashingWei = _slash(operator, uint(voteData));
        _kick(operator, 0);
        _addSponsorship(address(this), actualSlashingWei);
    }

    function getFlagData(address operator) override external view returns (uint flagData) {
        return operator.balance;
    }

    function getMinimumStakeOf(address) override external pure returns (uint individualMinimumStakeWei) {
        return 0;
    }
}
