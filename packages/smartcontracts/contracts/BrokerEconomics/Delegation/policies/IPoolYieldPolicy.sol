// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolYieldPolicy {
    function setParam(uint256 initialMargin, uint256 maintenanceMargin, uint256 minimumMargin, uint256 brokerShare, uint256 brokerShareMaxDivert) external;
    function deductBrokersShare(uint256 dataWei) external;
    function calculateBrokersShare(uint dataWei) external view returns(uint dataWeiBrokersShare);
    function pooltokenToData(uint256 poolTokenWei) external view returns (uint256 dataWei);
    function dataToPooltoken(uint256 dataWei) external view returns (uint256 poolTokenWei);
}
