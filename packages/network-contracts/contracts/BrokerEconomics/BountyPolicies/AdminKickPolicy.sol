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

    function onFlag(address broker) external {
        require(isAdmin(_msgSender()), "error_onlyAdmin");
        _kick(broker, 0);
    }

    function onVote(address, bytes32) external {
    }

    function getFlagData(address) override external pure returns (uint flagData) {
        return 0;
    }
}
