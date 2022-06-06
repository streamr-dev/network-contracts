// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

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
     * Only admin's report result in kicks, only 1 wei is slashed
     * Note that it's guaranteed that a staked broker must have at least 1 wei stake
     * @return kickPenaltyWei zero means do not kick
     */
    function onReport(address broker, address) external view returns (uint kickPenaltyWei) {
        return isAdmin(broker) ? 1 : 0;
    }
}
