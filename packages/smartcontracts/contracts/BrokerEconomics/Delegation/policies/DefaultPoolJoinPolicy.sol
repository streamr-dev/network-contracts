// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolJoinPolicy.sol";
import "../BrokerPool.sol";
import "hardhat/console.sol";
contract DefaultPoolJoinPolicy is IPoolJoinPolicy, BrokerPool {

    struct LocalStorage {
        uint256 initialMargin;
        uint256 minimumMarginPercent;
    }

     function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("brokerPool.storage.DefaultPoolJoinPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 initialMargin, uint256 minimumMarginPercent) external {
        LocalStorage storage data = localData();
        data.initialMargin = initialMargin;
        data.minimumMarginPercent = minimumMarginPercent;
    }

    function canJoin(address delegator) external view returns (uint canJoin){
        console.log("DefaultPoolJoinPolicy.onPoolJoin delegator", delegator);
        console.log("DefaultPoolJoinPolicy.onPoolJoin broker", globalData().broker);
        console.log("DefaultPoolJoinPolicy.onPoolJoin brokers balance", balanceOf(globalData().broker));
        console.log("DefaultPoolJoinPolicy.onPoolJoin total supply", totalSupply());
        console.log("DefaultPoolJoinPolicy.onPoolJoin initalMargin", localData().initialMargin);
        if (delegator == globalData().broker || localData().minimumMarginPercent == 0) {
            console.log("DefaultPoolJoinPolicy.onPoolJoin is broker or minimumMarginPercent is 0");
            return 1;
        }
        if (totalSupply() == 0) {
            console.log("DefaultPoolJoinPolicy.onPoolJoin total supply is 0");
            return 0;
        }
        bool allowed = balanceOf(globalData().broker) * 100 / totalSupply() >= localData().minimumMarginPercent;
        console.log("DefaultPoolJoinPolicy.onPoolJoin", delegator, allowed);
        return allowed ? 1 : 0;
        // return 1;
    }
}