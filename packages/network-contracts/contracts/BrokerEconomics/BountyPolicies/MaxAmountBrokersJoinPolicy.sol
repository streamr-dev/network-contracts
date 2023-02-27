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
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.MaxAmountBrokersJoinPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint256 maxBrokers) external {
        localData().maxBrokers = maxBrokers;
    }

    /** Check if there's room for one more */
    // solc-ignore-next-line func-mutability
    function onJoin(address, uint256) external {
        require(globalData().brokerCount < localData().maxBrokers, "error_tooManyBrokers");
    }
}
