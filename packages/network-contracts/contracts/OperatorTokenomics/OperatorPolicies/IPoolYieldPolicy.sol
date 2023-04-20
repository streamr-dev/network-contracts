// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolYieldPolicy {
    function setParam(uint256 initialMargin, uint256 maintenanceMargin, uint256 minimumMargin, uint256 operatorShare, uint256 operatorShareMaxDivert) external;
    function deductOperatorsShare(uint256 dataWei) external returns (uint operatorsShareDataWei);
    function calculateOperatorsShare(uint dataWei) external view returns(uint dataWeiOperatorsShare);
    function pooltokenToData(uint256 poolTokenWei, uint256 substractFromPoolvalue) external view returns (uint256 dataWei);
    function dataToPooltoken(uint256 dataWei, uint256 substractFromPoolvalue) external view returns (uint256 poolTokenWei);
}
