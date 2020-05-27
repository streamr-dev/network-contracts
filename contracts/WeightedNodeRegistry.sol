pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./WeightStrategy.sol";
import "./NodeRegistry.sol";

contract WeightedNodeRegistry is NodeRegistry {
    WeightStrategy strat;
    constructor(address owner_, bool requiresWhitelist_, address weightStrategy_, address[] memory initialNodes, string[] memory initialUrls)
         NodeRegistry(owner_, requiresWhitelist_, initialNodes, initialUrls) public {
       strat = WeightStrategy(weightStrategy_);
    }

    function getWeight(address nodeAddress) public view returns (uint) {
        return strat.getWeight(nodeAddress);
    }

    function setWeightStrategy(address weightStrategy_) public onlyOwner {
       strat = WeightStrategy(weightStrategy_);
    }
}