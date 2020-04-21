pragma solidity ^0.5.16;

interface WeightStrategy {
    function getWeight(address nodeAddress) external view returns (uint);
}