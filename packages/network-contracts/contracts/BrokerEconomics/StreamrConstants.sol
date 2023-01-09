// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract StreamrConstants is Initializable, UUPSUpgradeable, AccessControlUpgradeable {
    
    /** Lets say MIN_JOIN_TIME is the minimum time a broker has to be in a bounty without being slashed.
     *  This value can vary from bounty to bounty, and it can be 0, then the broker can leave immediately
     *  without being slashed.
     * 
     *  MAX_MIN_JOIN_TIME is the global maximum value that MIN_JOIN_TIME can have across all bounties.
     *  This garuantees that a broker (and thus a pool) can get the money back from any and all bounties
     *  without being slashed (provided it does the work) in a fixed maximum time.
     */
    uint public MAX_MIN_JOIN_TIME = 30 days;

    uint var2;
    uint var3;

    function initialize() public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function getUintVariable(string memory varName) public view returns (uint) {
        if (keccak256(abi.encodePacked(varName)) == keccak256(abi.encodePacked("MAX_MIN_JOIN_TIME"))) {
            return MAX_MIN_JOIN_TIME;
        } else if (keccak256(abi.encodePacked(varName)) == keccak256(abi.encodePacked("var2"))) {
            return var2;
        } else if (keccak256(abi.encodePacked(varName)) == keccak256(abi.encodePacked("var3"))) {
            return var3;
        } else {
            revert("Invalid variable name");
        }
    }
}