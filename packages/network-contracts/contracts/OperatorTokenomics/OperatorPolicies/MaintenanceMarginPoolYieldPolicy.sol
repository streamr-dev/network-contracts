// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IMaintenanceMarginPoolYieldPolicy.sol";
import "../Operator.sol";

contract MaintenanceMarginPoolYieldPolicy is IMaintenanceMarginPoolYieldPolicy, Operator {

    struct LocalStorage {
        uint initialMargin;  // is this really needed? it will always be 100% in the beginning
        uint maintenanceMarginPercent;
        uint minimumMarginFraction;
        uint operatorSharePercent;
        uint operatorShareMaxDivertPercent;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("operator.storage.DefaultPoolYieldPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint initialMargin, uint maintenanceMarginPercent, uint minimumMarginFraction, uint operatorSharePercent, uint operatorShareMaxDivertPercent) external {
        LocalStorage storage data = localData();
        data.initialMargin = initialMargin;
        // consolelog("DefaultPoolYieldPolicy.setParam: initialMargin:", initialMargin);
        require(maintenanceMarginPercent >= 0 && maintenanceMarginPercent < 100, "error_maintenanceMarginPercent");
        data.maintenanceMarginPercent = maintenanceMarginPercent;
        // consolelog("DefaultPoolYieldPolicy.setParam: maintenanceMarginPercent:", maintenanceMarginPercent);
        data.minimumMarginFraction = minimumMarginFraction;
        // consolelog("DefaultPoolYieldPolicy.setParam: minimumMarginFraction:", minimumMarginFraction);
        data.operatorSharePercent = operatorSharePercent;
        // consolelog("DefaultPoolYieldPolicy.setParam: operatorSharePercent:", operatorSharePercent);
        data.operatorShareMaxDivertPercent = operatorShareMaxDivertPercent;
        // consolelog("DefaultPoolYieldPolicy.setParam: operatorShareMaxDivertPercent:", operatorShareMaxDivertPercent);
    }

    function calculateOperatorsShare(uint dataWei) public view returns(uint dataWeiOperatorsShare) {
        // consolelog("## DefaultPoolYieldPolicy.calculateOperatorsShare", dataWei);
        // consolelog("DefaultPoolYieldPolicy.calculateOperatorsShare", dataWei);
        // consolelog("DefaultPoolYieldPolicy.calculateOperatorsShare absolute", dataWei * localData().operatorSharePercent / 100);
        return dataWei * localData().operatorSharePercent / 100;
    }

    function pooltokenToData(uint poolTokenWei, uint substractFromPoolvalue) public view returns (uint dataWei) {
        // consolelog("## DefaultPoolYieldPolicy.pooltokenToData", poolTokenWei, substractFromPoolvalue);
        if (this.totalSupply() == 0) {
            // consolelog("total supply is 0");
            return poolTokenWei;
        }
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData amount to convert", poolTokenWei);
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData substract", substractFromPoolvalue);
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData data balance of this", token.balanceOf(address(this)));
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData this totlasupply", this.totalSupply());
        // uint poolValueData = this.calculatePoolValueInData(substractFromPoolvalue);
        uint poolValueData = getApproximatePoolValue() - substractFromPoolvalue;
        // consolelog("DefaultPoolYieldPolicy.pooltokenToData poolValueData", poolValueData);
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint dataWei, uint substractFromPoolvalue) public view returns (uint poolTokenWei) {

        // in the beginning, the pool is empty => we set 1:1 exchange rate
        if (this.totalSupply() == 0) {
            // consolelog("total supply is 0");
            return dataWei;
        }
        uint poolValue = getApproximatePoolValue();
        assert(substractFromPoolvalue < poolValue);
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken amount to convert", dataWei);
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken substract", substractFromPoolvalue);
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken data balance of this", token.balanceOf(address(this)));
        // uint poolValueData = this.calculatePoolValueInData(substractFromPoolvalue);
        uint poolValueData = poolValue - substractFromPoolvalue;
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken data this totlasupply", this.totalSupply());
        // consolelog("DefaultPoolYieldPolicy.dataToPooltoken data poolValueData", poolValueData);
        return dataWei * this.totalSupply() / poolValueData;
    }

    function deductOperatorsShare(uint dataWei) external returns (uint operatorsShareDataWei) {
        // consolelog("## DefaultPoolYieldPolicy.deductOperatorsShare", dataWei);
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.localData().percentOperatorEarnings", localData().operatorSharePercent);
        operatorsShareDataWei = calculateOperatorsShare(dataWei);
        uint payoutDataWei = operatorsShareDataWei;
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare operatorsShareDataWei", operatorsShareDataWei);
        // if operators share of stake is less than maintenance margin, diect operatorShareMaxDivertPercent of his share to his stake
        uint operatorsShareOfStakePercent = balanceOf(owner) * 100 / totalSupply(); // 50 * 100 / 1000 = 5
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.operatorsShareOfStake", operatorsShareOfStakePercent);
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare operatorbalancePT", balanceOf(operator));
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare totalSupplyPT", totalSupply());
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.localData().maintenanceMarginPercent", localData().maintenanceMarginPercent);
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.localData().operatorShareMaxDivertPercent", localData().operatorShareMaxDivertPercent);
        if (operatorsShareOfStakePercent < localData().maintenanceMarginPercent) {
            uint noOperatorGoalPercent = 100 - localData().maintenanceMarginPercent; // 90
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.noOperatorGoalPercent", noOperatorGoalPercent);
            uint nonOperatorStake = totalSupply() - balanceOf(owner); // 1000 - 50 = 950
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.nonOperatorStake", nonOperatorStake);
            uint operatorStakeGoal = nonOperatorStake * localData().maintenanceMarginPercent / noOperatorGoalPercent; // 950 * 10 / 90 = 105.555
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.operatorStakeGoal", operatorStakeGoal);
            // uint operatorStakeGoal = localData().maintenanceMarginPercent * totalSupply() / 100; // 10 * 1000 / 100 = 100

            uint missingPoolToken = operatorStakeGoal - balanceOf(owner);
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.missingPoolToken", missingPoolToken);
            // "2 *" comes from that the incoming earnings are already in the pool's balance;
            //   and DOUBLE counted because update is done first and it adds earnings to total pool value
            uint divertDataWei = pooltokenToData(missingPoolToken, 2 * dataWei - operatorsShareDataWei); // operators share is already deducted from poolvalue
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.divertDataWei", divertDataWei);
            uint maxDivertableDataWei = operatorsShareDataWei * localData().operatorShareMaxDivertPercent / 100;
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.maxDivertableDataWei", maxDivertableDataWei);
            if (divertDataWei > maxDivertableDataWei) {
                divertDataWei = maxDivertableDataWei;
            }
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare diverting", divertDataWei);
            uint poolTokenToMint = dataToPooltoken(divertDataWei, 2 * dataWei - operatorsShareDataWei);
            payoutDataWei -= divertDataWei;
            _mint(owner, poolTokenToMint);
            // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare minted", poolTokenToMint);
        }
        token.transfer(owner, payoutDataWei);
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare transferred data to operator", operatorsShareDataWei);
        // return (operatorsShareDataWei, poolTokenToMint);

        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare operatorbalancePT", balanceOf(operator));
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare totalSupplyPT", totalSupply());
        // consolelog("DefaultPoolYieldPolicy.deductOperatorsShare.operatorsShareOfStakeAFTER", balanceOf(operator) * 100 / totalSupply());
    }
}
