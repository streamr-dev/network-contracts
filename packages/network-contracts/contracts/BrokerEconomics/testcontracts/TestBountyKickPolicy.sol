// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../BountyPolicies/IKickPolicy.sol";
import "../Bounty.sol";

import "hardhat/console.sol";

contract TestBountyKickPolicy is IKickPolicy, Bounty {
    // struct LocalStorage {
    // }

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.AdminKickPolicy", address(this)));
    //     assembly {data.slot := storagePosition}
    // }

    function setParam(uint256 _param) external {
    }

    /**
     * Only admin can kick.
     * Stake isn't slashed, broker is simply removed.
     */
    function onKick(address broker) external {
        console.log("onkick");
        require(isAdmin(_msgSender()), "error_onlyAdmin");
        _slash(broker, 0, true);
        emit BrokerKicked(broker, 0);
    }

    // solhint-disable-next-line no-unused-vars
    function onFlag(address broker, address brokerPool) external {
        console.log("onflag");
        require(isAdmin(_msgSender()), "error_onlyAdmin");
        _slash(broker, 10 ether, false);
    }

    function onCancelFlag(address, address brokerPool) external {
    }

    function onVote(address broker, bytes32 voteData) external {
    }
}
