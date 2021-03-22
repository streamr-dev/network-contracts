pragma solidity ^0.7.6;

interface WeightStrategy {
    function getWeight(address nodeAddress) external view returns (uint);
}