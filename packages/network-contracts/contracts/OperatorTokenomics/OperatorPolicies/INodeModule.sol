// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface INodeModule {
    function createCoordinationStream() external;
    function _setNodeAddresses(address[] calldata newNodes) external;
    function _updateNodeAddresses(address[] calldata addNodes, address[] calldata removeNodes) external;

}