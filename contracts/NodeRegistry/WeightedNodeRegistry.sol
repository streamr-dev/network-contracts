pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "./WeightStrategy.sol";
import "./NodeRegistry.sol";

contract WeightedNodeRegistry is NodeRegistry {
    WeightStrategy public strat;
    constructor(address owner_, bool requiresWhitelist_, address weightStrategy_, address[] memory initialNodes, string[] memory initialUrls)
         public NodeRegistry(owner_, requiresWhitelist_, initialNodes, initialUrls) {
       strat = WeightStrategy(weightStrategy_);
    }

    function getWeight(address nodeAddress) public view returns (uint) {
        return strat.getWeight(nodeAddress);
    }

    function setWeightStrategy(address weightStrategy_) public onlyOwner {
       strat = WeightStrategy(weightStrategy_);
    }
}