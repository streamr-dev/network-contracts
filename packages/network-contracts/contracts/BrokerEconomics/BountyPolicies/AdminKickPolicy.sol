// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Bounty.sol";

contract AdminKickPolicy is IKickPolicy, Bounty {
    // struct LocalStorage {
    // }

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.AdminKickPolicy", address(this)));
    //     assembly {data.slot := storagePosition}
    // }

    function setParam(uint256) external {
    }

    /**
     * Only admin can kick.
     * Stake isn't slashed, broker is simply removed.
     */
    function onKick(address broker) external {
        require(isAdmin(_msgSender()), "error_onlyAdmin");
        _removeBroker(broker);
        emit BrokerKicked(broker, 0);
    }

    function onFlag(address broker, address brokerPool) external {
    }

    function onCancelFlag(address, address brokerPool) external {
    }

    function onVote(address broker, bytes32 voteData) external {
    }
}