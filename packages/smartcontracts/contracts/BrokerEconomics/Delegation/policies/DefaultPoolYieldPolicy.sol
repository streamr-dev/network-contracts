// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolYieldPolicy.sol";
import "../BrokerPool.sol";
import "hardhat/console.sol";
contract DefaultPoolYieldPolicy is IPoolYieldPolicy, BrokerPool {

    struct LocalStorage {
        uint256 initialMargin;  // is this really needed? it will always be 100% in the beginning
        uint256 maintenanceMarginPercent;
        uint256 minimumMarginPercent;
        uint256 brokerSharePercent;
        uint256 brokerShareMaxDivertPercent;
    }

     function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("brokerPool.storage.DefaultPoolYieldPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 initialMargin, uint256 maintenanceMarginPercent, uint256 minimumMarginPercent, uint256 brokerSharePercent, uint256 brokerShareMaxDivertPercent) external {
        LocalStorage storage data = localData();
        data.initialMargin = initialMargin;
        data.maintenanceMarginPercent = maintenanceMarginPercent;
        data.minimumMarginPercent = minimumMarginPercent;
        data.brokerSharePercent = brokerSharePercent;
        data.brokerShareMaxDivertPercent = brokerShareMaxDivertPercent;
    }

    function calculateBrokersShare(uint dataWei) external view returns(uint dataWeiBrokersShare) {
        console.log("DefaultPoolYieldPolicy.calculateBrokersShare", dataWei);
        console.log("DefaultPoolYieldPolicy.calculateBrokersShare absolute", dataWei * localData().brokerSharePercent / 100);
        return dataWei * localData().brokerSharePercent / 100;
    }

    function pooltokenToData(uint256 poolTokenWei) public view returns (uint256 dataWei) {
        if (this.totalSupply() == 0) {
            console.log("total supply is 0");
            return poolTokenWei;
        }
        console.log("DefaultPoolYieldPolicy.pooltokenToData", poolTokenWei);
        console.log("data balance of this", globalData().token.balanceOf(address(this)));
        console.log("this totlasupply", this.totalSupply());
        uint poolValueData = this.calculatePoolValueInData(0);
        console.log("poolValueData", poolValueData);
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint256 dataWei) public view returns (uint256 poolTokenWei) {
        if (this.totalSupply() == 0) {
            console.log("total supply is 0");
            return dataWei;
        }
        console.log("DefaultPoolYieldPolicy.dataToPooltoken", dataWei);
        console.log("data balance of this", globalData().token.balanceOf(address(this)));
        uint poolValueData = this.calculatePoolValueInData(0);
        console.log("this totlasupply", this.totalSupply());
        console.log("poolValueData", poolValueData);
        if (poolValueData == 0) {
            return dataWei;
        }
        return dataWei * this.totalSupply() / poolValueData;
    }

    function deductBrokersShare(uint256 dataWei) external {
        console.log("DefaultPoolYieldPolicy.deductBrokersShare", dataWei);
        console.log("DefaultPoolYieldPolicy.deductBrokersShare.localData().percentBrokerEarnings", localData().brokerSharePercent);
        uint256 brokersShareDataWei = dataWei * localData().brokerSharePercent / 100;
        console.log("DefaultPoolYieldPolicy.deductBrokersShare sending", brokersShareDataWei);
        // if brokers share of stake is less than maintenance margin, diect brokerShareMaxDivertPercent of his share to his stake
        uint256 brokersShareOfStake = balanceOf(globalData().broker) * 100 / totalSupply();
        if(brokersShareOfStake < localData().maintenanceMarginPercent) {
            uint256 missingPercent = localData().maintenanceMarginPercent - brokersShareOfStake;
            uint256 missingPoolToken = missingPercent * totalSupply() / 100;
            uint256 divertDataWei = pooltokenToData(missingPoolToken);
            uint256 maxDivertableDataWei = brokersShareDataWei * localData().brokerShareMaxDivertPercent / 100;
            if (divertDataWei > maxDivertableDataWei) {
                divertDataWei = maxDivertableDataWei;
            }
            console.log("DefaultPoolYieldPolicy.deductBrokersShare diverting", divertDataWei);
            brokersShareDataWei -= divertDataWei;
            uint256 poolTokenToMint = dataToPooltoken(divertDataWei);
            _mint(globalData().broker, poolTokenToMint);
        }
        globalData().token.transfer(globalData().broker, brokersShareDataWei);
        // return (brokersShareDataWei, poolTokenToMint);
    }
}