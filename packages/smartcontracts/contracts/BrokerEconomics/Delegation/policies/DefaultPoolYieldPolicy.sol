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
        // console.log("DefaultPoolYieldPolicy.setParam: initialMargin:", initialMargin);
        data.maintenanceMarginPercent = maintenanceMarginPercent;
        // console.log("DefaultPoolYieldPolicy.setParam: maintenanceMarginPercent:", maintenanceMarginPercent);
        data.minimumMarginPercent = minimumMarginPercent;
        // console.log("DefaultPoolYieldPolicy.setParam: minimumMarginPercent:", minimumMarginPercent);
        data.brokerSharePercent = brokerSharePercent;
        // console.log("DefaultPoolYieldPolicy.setParam: brokerSharePercent:", brokerSharePercent);
        data.brokerShareMaxDivertPercent = brokerShareMaxDivertPercent;
        // console.log("DefaultPoolYieldPolicy.setParam: brokerShareMaxDivertPercent:", brokerShareMaxDivertPercent);
    }

    function calculateBrokersShare(uint dataWei) external view returns(uint dataWeiBrokersShare) {
        // console.log("DefaultPoolYieldPolicy.calculateBrokersShare", dataWei);
        // console.log("DefaultPoolYieldPolicy.calculateBrokersShare absolute", dataWei * localData().brokerSharePercent / 100);
        return dataWei * localData().brokerSharePercent / 100;
    }

    function pooltokenToData(uint256 poolTokenWei, uint256 substractFromPoolvalue) public view returns (uint256 dataWei) {
        if (this.totalSupply() == 0) {
            // console.log("total supply is 0");
            return poolTokenWei;
        }
        // console.log("DefaultPoolYieldPolicy.pooltokenToData", poolTokenWei);
        // console.log("data balance of this", globalData().token.balanceOf(address(this)));
        // console.log("this totlasupply", this.totalSupply());
        uint poolValueData = this.calculatePoolValueInData(substractFromPoolvalue);
        // console.log("poolValueData", poolValueData);
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint256 dataWei, uint256 substractFromPoolvalue) public view returns (uint256 poolTokenWei) {
        if (this.totalSupply() == 0) {
            // console.log("total supply is 0");
            return dataWei;
        }
        // console.log("DefaultPoolYieldPolicy.dataToPooltoken", dataWei);
        // console.log("data balance of this", globalData().token.balanceOf(address(this)));
        uint poolValueData = this.calculatePoolValueInData(substractFromPoolvalue);
        // console.log("this totlasupply", this.totalSupply());
        // console.log("poolValueData", poolValueData);
        if (poolValueData == 0) {
            return dataWei;
        }
        return dataWei * this.totalSupply() / poolValueData;
    }

    function deductBrokersShare(uint256 dataWei) external {
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare", dataWei);
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare.localData().percentBrokerEarnings", localData().brokerSharePercent);
        uint256 brokersShareDataWei = dataWei * localData().brokerSharePercent / 100;
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare brokersShareDataWei", brokersShareDataWei);
        // if brokers share of stake is less than maintenance margin, diect brokerShareMaxDivertPercent of his share to his stake
        uint256 brokersShareOfStake = balanceOf(globalData().broker) * 100 / totalSupply();
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare.brokersShareOfStake", brokersShareOfStake);
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare brokerbalancePT", balanceOf(globalData().broker));
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare totalSupplyPT", totalSupply());
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare.localData().maintenanceMarginPercent", localData().maintenanceMarginPercent);
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare.localData().brokerShareMaxDivertPercent", localData().brokerShareMaxDivertPercent);
        if(brokersShareOfStake < localData().maintenanceMarginPercent) {
            uint256 noBrokerGoalPercent = 100 - localData().maintenanceMarginPercent;
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare.noBrokerGoalPercent", noBrokerGoalPercent);
            uint256 nonBrokerStake = totalSupply() - balanceOf(globalData().broker);
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare.nonBrokerStake", nonBrokerStake);
            uint256 brokerStakeGoal = nonBrokerStake * localData().maintenanceMarginPercent / noBrokerGoalPercent;
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare.brokerStakeGoal", brokerStakeGoal);
            uint256 missingPoolToken = brokerStakeGoal - balanceOf(globalData().broker);
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare.missingPoolToken", missingPoolToken);
            uint256 divertDataWei = pooltokenToData(missingPoolToken, dataWei);
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare.divertDataWei", divertDataWei);
            uint256 maxDivertableDataWei = brokersShareDataWei * localData().brokerShareMaxDivertPercent / 100;
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare.maxDivertableDataWei", maxDivertableDataWei);
            if (divertDataWei > maxDivertableDataWei) {
                divertDataWei = maxDivertableDataWei;
            }
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare diverting", divertDataWei);
            brokersShareDataWei -= divertDataWei;
            uint256 poolTokenToMint = dataToPooltoken(divertDataWei, dataWei);
            _mint(globalData().broker, poolTokenToMint);
            // console.log("DefaultPoolYieldPolicy.deductBrokersShare minted", poolTokenToMint);
        }
        globalData().token.transfer(globalData().broker, brokersShareDataWei);
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare transferred data to broker", brokersShareDataWei);
        // return (brokersShareDataWei, poolTokenToMint);

        uint256 brokersShareOfStakeAFTER = balanceOf(globalData().broker) * 100 / totalSupply();
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare brokerbalancePT", balanceOf(globalData().broker));
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare totalSupplyPT", totalSupply());
        // console.log("DefaultPoolYieldPolicy.deductBrokersShare.brokersShareOfStakeAFTER", brokersShareOfStakeAFTER);
    }
}
