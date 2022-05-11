// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../policies/IJoinPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract TestJoinPolicy is IJoinPolicy, Bounty {

    // struct LocalStorage {
    //     uint256 minimumStake;
    // }

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.TestJoinPolicy", address(this)));
    //     assembly {data.slot := storagePosition}
    // }

    function setParam(uint256 minimumStake) external pure {
        if (minimumStake == 1) {
            require(false, "test-error: setting param join policy");
        } else if (minimumStake == 2) {
            require(false);
        }
    }

    function onJoin(address, uint256 amount) external pure {
        if (amount == 1) {
            require(false, "test-error: onJoin join policy");
        } else if (amount == 2) {
            require(false);
        }
    }
}