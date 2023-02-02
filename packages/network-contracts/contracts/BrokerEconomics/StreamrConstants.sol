// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
/* solhint-disable var-name-mixedcase */

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract StreamrConstants is Initializable, UUPSUpgradeable, AccessControlUpgradeable {

    /**
     * MAX_SLASH_TIME is the maximum time a bounty can slash a broker for leaving early.
     *
     * Lets say MIN_JOIN_TIME is the minimum time a broker has to be in a bounty without being slashed.
     * This value can vary from bounty to bounty, and it can be 0, then the broker can leave immediately
     * without being slashed.
     *
     * MAX_SLASH_TIME is the global maximum value that MIN_JOIN_TIME can have across all bounties.
     * This garuantees that a broker (and thus a pool) can get the money back from any and all bounties
     * without being slashed (provided it does the work) in a fixed maximum time.
     */
    uint public MAX_SLASH_TIME = 30 days; // TODO: maybe name MAX_SLASH_TIME_SECONDS?

    /**
     * The actual poolvalue can not be kept track of, since it would mean looping through all bounties
     * in each transaction. Everyone can update the poolvalue of a list of bounties. If the difference
     * between the actual poolvalue and the updated poolvalue is more than PERCENT_DIFF_APPROX_POOL_VALUE,
     * the broker is slashed a little.
     */
    uint public PERCENT_DIFF_APPROX_POOL_VALUE = 10; // TODO: probably use wei/ether

    /**
     * In the case above, this is the percentage in thousandths
     * of hist stake that the broker is slashed. 5 is half a %.
     */
    uint public PUNISH_BROKERS_PT_THOUSANDTH = 5; // TODO: use wei/ether

    function initialize() public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // TODO: what would this be used for?
    function getUintVariable(string memory varName) public view returns (uint) {
        if (keccak256(abi.encodePacked(varName)) == keccak256(abi.encodePacked("MAX_MIN_JOIN_TIME"))) {
            return MAX_SLASH_TIME;
        } else if (keccak256(abi.encodePacked(varName)) == keccak256(abi.encodePacked("PERCENT_DIFF_APPROX_POOL_VALUE"))) {
            return PERCENT_DIFF_APPROX_POOL_VALUE;
        } else if (keccak256(abi.encodePacked(varName)) == keccak256(abi.encodePacked("PUNISH_BROKERS_PT_THOUSANDTH"))) {
            return PUNISH_BROKERS_PT_THOUSANDTH;
        } else {
            revert("Invalid variable name");
        }
    }
}
