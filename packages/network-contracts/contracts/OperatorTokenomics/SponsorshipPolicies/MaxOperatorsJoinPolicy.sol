// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IJoinPolicy.sol";
import "../Sponsorship.sol";

// import "hardhat/console.sol";

contract MaxOperatorsJoinPolicy is IJoinPolicy, Sponsorship {
    struct LocalStorage {
        uint256 maxOperators;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("sponsorship.storage.MaxOperatorsJoinPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint256 maxOperators) external {
        localData().maxOperators = maxOperators;
    }

    // solc-ignore-next-line func-mutability
    function onJoin(address, uint256) external {
        require(operatorCount <= localData().maxOperators, "error_tooManyOperators");
    }
}
