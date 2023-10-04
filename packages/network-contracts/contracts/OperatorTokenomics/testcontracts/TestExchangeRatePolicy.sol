// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../OperatorPolicies/IExchangeRatePolicy.sol";

contract TestExchangeRatePolicy is IExchangeRatePolicy {

    function supportsInterface(bytes4) public pure returns (bool) {
        return interfaceId == type(IExchangeRatePolicy).interfaceId;
    }

    function setParam(uint) external {}

    function operatorTokenToData(uint) external view returns (uint) {
        // solhint-disable-next-line reason-string
        require(false); // using delegatecall the (success, data) returned values will be (0, 0)
    }

    function operatorTokenToDataInverse(uint) external view returns (uint) {}

    function dataToOperatorToken(uint, uint) external view returns (uint) {
        return 100;
    }
}
