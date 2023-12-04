// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "../OperatorTokenomics/StreamrConfig.sol";

/**
 * @title StreamrPreferences
 *
 * Contract for managing your own Streamr Network preferences.
 * Network-wide "admin configs" are found in [StreamrConfig.sol](../OperatorTokenomics/StreamrConfig.sol).
 */
contract StreamrPreferences is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    event DelegatorPreferencesUpdated(address indexed delegator, uint indexed preferences, uint indexed changedBits);

    // delegate votes by default, opt out when this bit is set
    uint public constant DELEGATION_OPT_OUT_BITMASK = 1;

    mapping (address => uint) public delegatorPreferences;

    StreamrConfig public streamrConfig;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(
        address streamrConfigAddress
    ) public initializer {
        streamrConfig = StreamrConfig(streamrConfigAddress);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _setupRole(ADMIN_ROLE, _msgSender());
    }

    function isTrustedForwarder(address forwarder) public view override(ERC2771ContextUpgradeable) returns (bool) {
        return streamrConfig.trustedForwarder() == forwarder;
    }

    /**
     * By default in Snapshot voting, the delegator's votes are delegated to the operator along with DATA.
     * Use this setter to opt out, and use those votes yourself instead.
     * @param willDelegateVotes false = opt out, true = opt in
     */
    function setDelegateVote(bool willDelegateVotes) external {
        address delegator = _msgSender();
        if (willDelegateVotes) {
            delegatorPreferences[delegator] &= ~DELEGATION_OPT_OUT_BITMASK;
        } else {
            delegatorPreferences[delegator] |= DELEGATION_OPT_OUT_BITMASK;
        }
        emit DelegatorPreferencesUpdated(delegator, delegatorPreferences[delegator], DELEGATION_OPT_OUT_BITMASK);
    }

    function _authorizeUpgrade(address newImplementation) internal onlyRole(ADMIN_ROLE) override {}

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }
}
