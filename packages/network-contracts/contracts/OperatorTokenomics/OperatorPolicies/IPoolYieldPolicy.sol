// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolYieldPolicy {
    function setParam(uint param) external;

    /**
     * Exchange rate between DATA and Operator's own token
     * @param poolTokenWei Amount of Operator's own token
     * @param substractFromPoolvalue Amount of DATA to subtract from pool value for calculations (because DATA balance already was incremented but calculation wants the pre-increment value)
     */
    function pooltokenToData(uint poolTokenWei, uint substractFromPoolvalue) external view returns (uint dataWei);

    /**
     * Exchange rate between DATA and Operator's own token
     * @param dataWei Amount of DATA
     * @param substractFromPoolvalue Amount of DATA to subtract from pool value for calculations (because DATA balance already was decremented but calculation wants the pre-decrement value)
     **/
    function dataToPooltoken(uint dataWei, uint substractFromPoolvalue) external view returns (uint poolTokenWei);
}
