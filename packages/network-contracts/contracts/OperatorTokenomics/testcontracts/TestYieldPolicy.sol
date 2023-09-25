// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../OperatorPolicies/IPoolYieldPolicy.sol";

contract TestYieldPolicy is IPoolYieldPolicy {

    function setParam(uint) external {}

    function pooltokenToData(uint poolTokenWei, uint subtractFromPoolvalue) public view returns (uint dataWei) {
        // solhint-disable-next-line reason-string
        require(false); // using delegatecall the (success, data) returned values will be (0, 0)
    }

    function dataToPooltoken(uint dataWei, uint subtractFromPoolvalue) public view returns (uint poolTokenWei) {
        require(false, "revertedWithStringReason"); // using delegatecall the (success, data) returned values will be (0, 100)
    }
}
