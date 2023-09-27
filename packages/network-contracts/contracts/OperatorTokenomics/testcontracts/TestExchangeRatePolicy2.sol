// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../OperatorPolicies/IExchangeRatePolicy.sol";

contract TestExchangeRatePolicy2 is IExchangeRatePolicy {

    function setParam(uint) external {}

    function operatorTokenToData(uint) external view returns (uint) {
        require(false, "revertedWithStringReason"); // using delegatecall the (success, data) returned values will be (0, 100)
    }

    function operatorTokenToDataInverse(uint dataWei) external view returns (uint) {}

    function dataToOperatorToken(uint, uint) external view returns (uint) {
        return 100;
    }
}
