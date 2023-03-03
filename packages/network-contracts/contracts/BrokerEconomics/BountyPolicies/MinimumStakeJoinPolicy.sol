// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IJoinPolicy.sol";
import "../Bounty.sol";

// import "hardhat/console.sol";

contract MinimumStakeJoinPolicy is IJoinPolicy, Bounty {
    struct LocalStorage {
        uint256 minimumStake;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.MinimumStakeJoinPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint256 minimumStake) external {
        localData().minimumStake = minimumStake;
    }

    // solc-ignore-next-line func-mutability
    function onJoin(address broker, uint256 amount) external {
        require(globalData().stakedWei[broker] + amount >= localData().minimumStake, "error_stakeUnderMinimum");
    }
}
