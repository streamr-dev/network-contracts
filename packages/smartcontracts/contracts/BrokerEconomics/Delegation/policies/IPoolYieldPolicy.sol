// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IPoolYieldPolicy {
    function setParam(uint256 param) external;
    function handleBountyWithdrawl(uint256 dataWei) external;
    function pooltokenToData(uint256 poolTokenWei) external view returns (uint256 dataWei);
    function dataToPooltoken(uint256 dataWei) external view returns (uint256 poolTokenWei);
}
