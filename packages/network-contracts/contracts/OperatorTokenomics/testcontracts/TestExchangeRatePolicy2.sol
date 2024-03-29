// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../OperatorPolicies/IExchangeRatePolicy.sol";

contract TestExchangeRatePolicy2 is IExchangeRatePolicy {

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == type(IExchangeRatePolicy).interfaceId;
    }

    function setParam(uint) external {}

    function operatorTokenToData(uint) external view returns (uint) {
        require(false, "revertedWithStringReason"); // using delegatecall the (success, data) returned values will be (0, 100)
    }

    function operatorTokenToDataInverse(uint dataWei) external view returns (uint) {}

    function dataToOperatorToken(uint dataWei, uint) external view returns (uint) {
        return dataWei;
    }
}
