// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolYieldPolicy {
    function setParam(uint256 param) external;
    function deductBrokersShare(uint256 dataWei) external;
    function calculateBrokersShare(uint dataWei) external view returns(uint dataWeiBrokersShare);
    function pooltokenToData(uint256 poolTokenWei) external view returns (uint256 dataWei);
    function dataToPooltoken(uint256 dataWei) external view returns (uint256 poolTokenWei);
}
