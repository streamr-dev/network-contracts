// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolYieldPolicy.sol";
import "../Operator.sol";

contract DefaultPoolYieldPolicy is IPoolYieldPolicy, Operator {

    //struct LocalStorage {
    //}
    //function localData() internal view returns(LocalStorage storage data) {
    //    bytes32 storagePosition = keccak256(abi.encodePacked("operator.storage.DefaultPoolYieldPolicy", address(this)));
    //    assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    //}

    function setParam(uint) external {
    }

    function pooltokenToData(uint poolTokenWei, uint subtractFromPoolvalue) public view returns (uint dataWei) {
        if (this.totalSupply() == 0) {
            return poolTokenWei;
        }
        uint poolValueData = getApproximatePoolValue() - subtractFromPoolvalue;
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint dataWei, uint subtractFromPoolvalue) public view returns (uint poolTokenWei) {
        // in the beginning, the pool is empty => we set 1:1 exchange rate
        if (this.totalSupply() == 0) {
            return dataWei;
        }
        uint poolValue = getApproximatePoolValue();
        assert(subtractFromPoolvalue < poolValue);
        uint poolValueData = poolValue - subtractFromPoolvalue;
        // uint poolValueData = this.calculatePoolValueInData(subtractFromPoolvalue);

        return dataWei * this.totalSupply() / poolValueData;
    }
}
