// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IJoinPolicy.sol";
import "../Sponsorship.sol";

interface IFactory {
    function deploymentTimestamp(address) external view returns (uint); // zero for contracts not deployed by this factory
}

/**
 * Only Operator contracts that were deployed using the official OperatorFactory are allowed to join
 */
contract OperatorContractOnlyJoinPolicy is IJoinPolicy, Sponsorship {
    function setParam(uint256) external {
    }

    // solc-ignore-next-line func-mutability
    function onJoin(address operator, uint256) external {
        require(IFactory(streamrConfig.operatorFactory()).deploymentTimestamp(operator) > 0, "error_onlyOperators");
    }
}
