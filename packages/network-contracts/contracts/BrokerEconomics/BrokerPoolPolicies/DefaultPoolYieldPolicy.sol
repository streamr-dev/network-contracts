// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolYieldPolicy.sol";
import "../BrokerPool.sol";

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
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint256 initialMargin, uint256 maintenanceMarginPercent, uint256 minimumMarginPercent, uint256 brokerSharePercent, uint256 brokerShareMaxDivertPercent) external {
        LocalStorage storage data = localData();
        data.initialMargin = initialMargin;
        // consolelog("DefaultPoolYieldPolicy.setParam: initialMargin:", initialMargin);
        require(maintenanceMarginPercent >= 0 && maintenanceMarginPercent < 100, "error_maintenanceMarginPercent");
        data.maintenanceMarginPercent = maintenanceMarginPercent;
        // consolelog("DefaultPoolYieldPolicy.setParam: maintenanceMarginPercent:", maintenanceMarginPercent);
        data.minimumMarginPercent = minimumMarginPercent;
        // consolelog("DefaultPoolYieldPolicy.setParam: minimumMarginPercent:", minimumMarginPercent);
        data.brokerSharePercent = brokerSharePercent;
        // consolelog("DefaultPoolYieldPolicy.setParam: brokerSharePercent:", brokerSharePercent);
        data.brokerShareMaxDivertPercent = brokerShareMaxDivertPercent;
        // consolelog("DefaultPoolYieldPolicy.setParam: brokerShareMaxDivertPercent:", brokerShareMaxDivertPercent);
    }

    function calculateBrokersShare(uint dataWei) external view returns(uint dataWeiBrokersShare) {
        // consolelog("## DefaultPoolYieldPolicy.calculateBrokersShare", dataWei);
        // consolelog("DefaultPoolYieldPolicy.calculateBrokersShare", dataWei);
        // consolelog("DefaultPoolYieldPolicy.calculateBrokersShare absolute", dataWei * localData().brokerSharePercent / 100);
        return dataWei * localData().brokerSharePercent / 100;
    }

    function pooltokenToData(uint256 poolTokenWei, uint256 substractFromPoolvalue) public view returns (uint256 dataWei) {
        // consolelog("## DefaultPoolYieldPolicy.pooltokenToData", poolTokenWei, substractFromPoolvalue);
        if (this.totalSupply() == 0) {
            // consolelog("total supply is 0");
            return poolTokenWei;
        }
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData amount to convert", poolTokenWei);
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData substract", substractFromPoolvalue);
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData data balance of this", globalData().token.balanceOf(address(this)));
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData this totlasupply", this.totalSupply());
        // uint poolValueData = this.calculatePoolValueInData(substractFromPoolvalue);
        uint poolValueData = getApproximatePoolValue() - substractFromPoolvalue;
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData poolValueData", poolValueData);
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint256 dataWei, uint256 substractFromPoolvalue) public view returns (uint256 poolTokenWei) {

        // in the beginning, the pool is empty => we set 1:1 exchange rate
        if (this.totalSupply() == 0) {
            // consolelog("total supply is 0");
            return dataWei;
        }
        uint poolValue = getApproximatePoolValue();
        assert(substractFromPoolvalue < poolValue);
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken amount to convert", dataWei);
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken substract", substractFromPoolvalue);
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken data balance of this", globalData().token.balanceOf(address(this)));
        // uint poolValueData = this.calculatePoolValueInData(substractFromPoolvalue);
        uint poolValueData = poolValue - substractFromPoolvalue;
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken data this totlasupply", this.totalSupply());
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken data poolValueData", poolValueData);
        return dataWei * this.totalSupply() / poolValueData;
    }

    function deductBrokersShare(uint256 dataWei) external {
        // consolelog("## DefaultPoolYieldPolicy.deductBrokersShare", dataWei);
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.localData().percentBrokerEarnings", localData().brokerSharePercent);
        uint256 brokersShareDataWei = dataWei * localData().brokerSharePercent / 100;
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare brokersShareDataWei", brokersShareDataWei);
        // if brokers share of stake is less than maintenance margin, diect brokerShareMaxDivertPercent of his share to his stake
        uint256 brokersShareOfStakePercent = balanceOf(globalData().broker) * 100 / totalSupply(); // 50 * 100 / 1000 = 5
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.brokersShareOfStake", brokersShareOfStake);
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare brokerbalancePT", balanceOf(globalData().broker));
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare totalSupplyPT", totalSupply());
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.localData().maintenanceMarginPercent", localData().maintenanceMarginPercent);
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.localData().brokerShareMaxDivertPercent", localData().brokerShareMaxDivertPercent);
        if (brokersShareOfStakePercent < localData().maintenanceMarginPercent) {
            uint256 noBrokerGoalPercent = 100 - localData().maintenanceMarginPercent; // 90
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.noBrokerGoalPercent", noBrokerGoalPercent);
            uint256 nonBrokerStake = totalSupply() - balanceOf(globalData().broker); // 1000 - 50 = 950
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.nonBrokerStake", nonBrokerStake);
            uint256 brokerStakeGoal = nonBrokerStake * localData().maintenanceMarginPercent / noBrokerGoalPercent; // 950 * 10 / 90 = 105.555
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.brokerStakeGoal", brokerStakeGoal);
            // uint256 brokerStakeGoal = localData().maintenanceMarginPercent * totalSupply() / 100; // 10 * 1000 / 100 = 100

            uint256 missingPoolToken = brokerStakeGoal - balanceOf(globalData().broker);
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.missingPoolToken", missingPoolToken);
            // "2 *" comes from that the incoming winnings are already in the pool's balance;
            //   and DOUBLE counted because update is done first and it adds winnings to total pool value
            uint256 divertDataWei = pooltokenToData(missingPoolToken, 2 * dataWei - brokersShareDataWei); // brokers share is already deducted from poolvalue
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.divertDataWei", divertDataWei);
            uint256 maxDivertableDataWei = brokersShareDataWei * localData().brokerShareMaxDivertPercent / 100;
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.maxDivertableDataWei", maxDivertableDataWei);
            if (divertDataWei > maxDivertableDataWei) {
                divertDataWei = maxDivertableDataWei;
            }
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare diverting", divertDataWei);
            uint256 poolTokenToMint = dataToPooltoken(divertDataWei, 2 * dataWei - brokersShareDataWei);
            brokersShareDataWei -= divertDataWei;
            _mint(globalData().broker, poolTokenToMint);
            // consolelog("DefaultPoolYieldPolicy.deductBrokersShare minted", poolTokenToMint);
        }
        globalData().token.transfer(globalData().broker, brokersShareDataWei);
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare transferred data to broker", brokersShareDataWei);
        // return (brokersShareDataWei, poolTokenToMint);

        // uint256 brokersShareOfStakeAFTER = balanceOf(globalData().broker) * 100 / totalSupply();
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare brokerbalancePT", balanceOf(globalData().broker));
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare totalSupplyPT", totalSupply());
        // consolelog("DefaultPoolYieldPolicy.deductBrokersShare.brokersShareOfStakeAFTER", brokersShareOfStakeAFTER);
    }
}
