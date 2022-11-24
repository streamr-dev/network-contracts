// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "./WeightStrategy.sol";
import "./NodeRegistry.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/Initializable.sol";

contract WeightedNodeRegistry is NodeRegistry {
    WeightStrategy public strat;

    // Constructor can't be used with upgradeable contracts, so use initialize instead
    //    this will not be called upon each upgrade, only once during first deployment
    function initialize(address owner_, bool requiresWhitelist_, address weightStrategy_, address[] memory initialNodes, string[] memory initialUrls) public initializer {
       NodeRegistry.initialize(owner_, requiresWhitelist_, initialNodes, initialUrls);
       strat = WeightStrategy(weightStrategy_);
    }

    function getWeight(address nodeAddress) public view returns (uint) {
        return strat.getWeight(nodeAddress);
    }

    function setWeightStrategy(address weightStrategy_) public onlyOwner {
       strat = WeightStrategy(weightStrategy_);
    }
}