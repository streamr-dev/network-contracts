// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

interface IAllocationPolicy {
    function setParam(uint param) external;
    function calculateAllocation(address broker) external returns (uint allocation);
    function getHorizonSeconds() external view returns (uint horizonSeconds);
    function onJoin(address broker) external;
    function onLeave(address broker) external;
    function onStakeIncrease(address broker) external;
}
