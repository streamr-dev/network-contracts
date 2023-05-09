// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolYieldPolicy {
    function setParam(uint256 param) external;
    function pooltokenToData(uint256 poolTokenWei, uint256 substractFromPoolvalue) external view returns (uint256 dataWei);
    function dataToPooltoken(uint256 dataWei, uint256 substractFromPoolvalue) external view returns (uint256 poolTokenWei);
}
