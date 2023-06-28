// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolYieldPolicy.sol";
import "../Operator.sol";

import "hardhat/console.sol";

contract DefaultPoolYieldPolicy is IPoolYieldPolicy, Operator {

    //struct LocalStorage {
    //}
    //function localData() internal view returns(LocalStorage storage data) {
    //    bytes32 storagePosition = keccak256(abi.encodePacked("operator.storage.DefaultPoolYieldPolicy", address(this)));
    //    assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    //}

    function setParam(uint256) external {
    }

    function pooltokenToData(uint poolTokenWei, uint subtractFromPoolvalue) public view returns (uint dataWei) {
        if (this.totalSupply() == 0) {
            return poolTokenWei;
        }
        uint poolValueData = getApproximatePoolValue() - subtractFromPoolvalue;
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint dataWei, uint subtractFromPoolvalue) public view returns (uint poolTokenWei) {
        console.log("dataToPooltoken: dataWei=%s, subtractFromPoolvalue=%s", dataWei / 1 ether, subtractFromPoolvalue / 1 ether);
        // in the beginning, the pool is empty => we set 1:1 exchange rate
        if (this.totalSupply() == 0) {
            return dataWei;
        }
        uint poolValue = getApproximatePoolValue(); // 1500 + 500 = 2000
        console.log("dataToPooltoken: poolValue=%s", poolValue / 1 ether);
        assert(subtractFromPoolvalue < poolValue);
        uint poolValueData = poolValue - subtractFromPoolvalue; // 2000 - 
        console.log("dataToPooltoken: poolValueData=%s", poolValueData / 1 ether);
        // uint poolValueData = this.calculatePoolValueInData(subtractFromPoolvalue);

        console.log("dataToPooltoken: dataWei=%s, totalSupply=%s, poolValueData=%s", dataWei / 1 ether, this.totalSupply() / 1 ether, poolValueData / 1 ether);
        return dataWei * this.totalSupply() / poolValueData;
    }
}
