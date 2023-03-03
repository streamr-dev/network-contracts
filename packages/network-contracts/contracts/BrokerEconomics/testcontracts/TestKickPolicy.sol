// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../BountyPolicies/IKickPolicy.sol";
import "../Bounty.sol";

import "hardhat/console.sol";

contract TestKickPolicy is IKickPolicy, Bounty {
    // struct LocalStorage {
    // }

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.AdminKickPolicy", address(this)));
    //     assembly {data.slot := storagePosition}
    // }

    function setParam(uint256 _param) external {
    }

    // solhint-disable-next-line no-unused-vars
    function onFlag(address broker) external {
        console.log("onflag");
        require(isAdmin(_msgSender()), "error_onlyAdmin");
        _slash(broker, 10 ether, false);
    }

    // solhint-disable-next-line no-unused-vars
    function onCancelFlag(address broker) external {
        console.log("onkick");
        require(isAdmin(_msgSender()), "error_onlyAdmin");
        _slash(broker, 0, true);
    }

    function onVote(address broker, bytes32 voteData) external {
    }

    // solhint-disable-next-line no-unused-vars
    function getFlagData(address broker) override external pure returns (uint flagData) {
        return 0;
    }
}
