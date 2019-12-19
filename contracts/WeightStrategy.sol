pragma solidity >=0.4.21 <0.6.0;

interface WeightStrategy {
    function getWeight(address nodeAddress) external view returns (uint);
}