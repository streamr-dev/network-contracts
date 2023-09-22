// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IExchangeRatePolicy {
    function setParam(uint param) external;

    /**
     * Exchange rate from Operator's internal token to DATA when undelegating
     * @param operatorTokenWei Amount of Operator's internal token
     */
    function operatorTokenToData(uint operatorTokenWei) external view returns (uint dataWei);

    /**
     * Exchange rate from DATA to Operator's internal token when delegating
     * @param dataWei Amount of DATA token
     * @param alreadyTransferredWei Amount of DATA to subtract from Operator value for calculations (because DATA balance already was incremented but calculation needs the pre-increment value)
     **/
    function dataToOperatorToken(uint dataWei, uint alreadyTransferredWei) external view returns (uint operatorTokenWei);
}
