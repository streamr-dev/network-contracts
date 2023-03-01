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

    function onFlag(address broker, address) external {
        require(isAdmin(_msgSender()), "error_onlyAdmin");
        _slash(broker, 0, true);
        emit BrokerKicked(broker, 0);
    }

    function onCancelFlag(address, address) external {
    }

    function onVote(address, bytes32) external {
    }
}
