// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolJoinPolicy.sol";
import "../BrokerPool.sol";
// import "hardhat/console.sol";

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

    function canJoin(address delegator) external view returns (uint allowedToJoin) {
        // console.log("DefaultPoolJoinPolicy.onPoolJoin delegator", delegator);
        // console.log("DefaultPoolJoinPolicy.onPoolJoin broker", globalData().broker);
        // console.log("DefaultPoolJoinPolicy.onPoolJoin brokers balance", balanceOf(globalData().broker));
        // console.log("DefaultPoolJoinPolicy.onPoolJoin total supply", totalSupply());
        // console.log("DefaultPoolJoinPolicy.onPoolJoin initalMargin", localData().initialMargin);

        // can't join into an empty pool (unless it's the broker, or we don't require a minimum margin)
        if (delegator == globalData().broker || localData().minimumMarginPercent == 0) { return 1; }
        if (totalSupply() == 0) { return 0; }
        if (balanceOf(globalData().broker) * 100 / totalSupply() >= localData().minimumMarginPercent) { return 0; }
        return 1;
    }
}
