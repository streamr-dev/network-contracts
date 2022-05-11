// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IJoinPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract MaxAmountBrokersJoinPolicy is IJoinPolicy, Bounty {
    struct LocalStorage {
        uint256 maxBrokers;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.MaximumBrokersJoinPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 maxBrokers) external {
        localData().maxBrokers = maxBrokers;
    }

    /** Check if there's room for one more */
    function onJoin(address, uint256) external view {
        require(globalData().brokerCount < localData().maxBrokers, "error_tooManyBrokers");
    }
}
