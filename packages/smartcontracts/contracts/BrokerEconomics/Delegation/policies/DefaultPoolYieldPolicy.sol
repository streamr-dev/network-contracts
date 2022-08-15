// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolYieldPolicy.sol";
import "../BrokerPool.sol";
import "hardhat/console.sol";
contract DefaultPoolYieldPolicy is IPoolYieldPolicy, BrokerPool {

    struct LocalStorage {
        uint256 percentBrokerEarnings;
    }

     function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("brokerPool.storage.DefaultPoolYieldPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 percentBrokerEarnings) external {
        console.log("DefaultPoolYieldPolicy.setParam", percentBrokerEarnings);
        localData().percentBrokerEarnings = percentBrokerEarnings;
    }

    function calculateBrokersShare(uint dataWei) external view returns(uint dataWeiBrokersShare) {
        console.log("DefaultPoolYieldPolicy.calculateBrokersShare", dataWei);
        console.log("DefaultPoolYieldPolicy.calculateBrokersShare absolute", dataWei * localData().percentBrokerEarnings / 100);
        return dataWei * localData().percentBrokerEarnings / 100;
    }

    function deductBrokersShare(uint256 dataWei) external {
        console.log("DefaultPoolYieldPolicy.deductBrokersShare", dataWei);
        console.log("DefaultPoolYieldPolicy.deductBrokersShare.localData().percentBrokerEarnings", localData().percentBrokerEarnings);
        uint256 brokersShare = dataWei * localData().percentBrokerEarnings / 100;
        console.log("DefaultPoolYieldPolicy.deductBrokersShare sending", brokersShare);
        globalData().token.transfer(globalData().broker, brokersShare);
    }

    function pooltokenToData(uint256 poolTokenWei) external view returns (uint256 dataWei) {
        if (this.totalSupply() == 0) {
            console.log("total supply is 0");
            return poolTokenWei;
        }
        console.log("DefaultPoolYieldPolicy.pooltokenToData", poolTokenWei);
        console.log("data balance of this", globalData().token.balanceOf(address(this)));
        console.log("this totlasupply", this.totalSupply());
        uint poolValueData = this.calculatePoolValueInData();
        console.log("poolValueData", poolValueData);
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint256 dataWei) external view returns (uint256 poolTokenWei) {
        if (this.totalSupply() == 0) {
            console.log("total supply is 0");
            return dataWei;
        }
        console.log("DefaultPoolYieldPolicy.dataToPooltoken", dataWei);
        console.log("data balance of this", globalData().token.balanceOf(address(this)));
        uint poolValueData = this.calculatePoolValueInData();
        console.log("this totlasupply", this.totalSupply());
        console.log("poolValueData", poolValueData);
        if (poolValueData == 0) {
            return dataWei;
        }
        return dataWei * this.totalSupply() / poolValueData;
    }
}