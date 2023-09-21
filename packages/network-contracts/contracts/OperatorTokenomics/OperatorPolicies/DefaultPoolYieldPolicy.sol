// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IPoolYieldPolicy.sol";
import "../Operator.sol";

contract DefaultPoolYieldPolicy is IPoolYieldPolicy, Operator {

    function setParam(uint) external {

    }

    function pooltokenToData(uint poolTokenWei, uint subtractFromPoolvalue) public view returns (uint dataWei) {
        if (this.totalSupply() == 0) {
            return poolTokenWei;
        }
        uint poolValueData = valueWithoutEarnings() - subtractFromPoolvalue;
        return poolTokenWei * poolValueData / this.totalSupply();
    }

    function dataToPooltoken(uint dataWei, uint subtractFromPoolvalue) public view returns (uint poolTokenWei) {
        // in the beginning, the pool is empty => we set 1:1 exchange rate
        if (this.totalSupply() == 0) {
            return dataWei;
        }
        uint valueWithoutEarnings = valueWithoutEarnings();
        assert(subtractFromPoolvalue < valueWithoutEarnings);
        uint poolValueData = valueWithoutEarnings - subtractFromPoolvalue;

        return dataWei * this.totalSupply() / poolValueData;
    }
}
