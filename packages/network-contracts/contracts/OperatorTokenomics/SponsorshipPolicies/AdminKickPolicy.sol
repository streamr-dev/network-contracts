// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Sponsorship.sol";

contract AdminKickPolicy is IKickPolicy, Sponsorship {
    struct LocalStorage {
        address admin;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("sponsorship.storage.AdminKickPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint adminAdress) external {
        localData().admin = address(uint160(adminAdress));
    }

    function onFlag(address operator, address) external {
        require(localData().admin == _msgSender(), "error_onlyAdmin");
        _kick(operator, 0);
    }

    function onVote(address, bytes32, address) external {
    }

    function getFlagData(address) override external pure returns (uint flagData) {
        return 0;
    }
}
