// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "./Sponsorship.sol";
import "./IERC677.sol";
import "./StreamrConfig.sol";

import "../StreamRegistry/IStreamRegistryV4.sol";

/**
 * SponsorshipFactory creates Sponsorships that respect Streamr Network rules and StreamrConfig.
 * Only Sponsorships from this SponsorshipFactory can be used in Streamr Network, and staked into by Operators.
 */
contract SponsorshipFactory is Initializable, AccessControlUpgradeable, UUPSUpgradeable, ERC2771ContextUpgradeable {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    error StreamNotFound();
    error BadArguments();
    error AllocationPolicyRequired();
    error PolicyNotTrusted();

    StreamrConfig public streamrConfig;
    address public sponsorshipContractTemplate;
    address public tokenAddress;
    mapping(address => bool) public trustedPolicies;
    mapping(address => uint) public deploymentTimestamp; // zero for contracts not deployed by this factory

    event NewSponsorship(address indexed sponsorshipContract, string streamId, string metadata, address[] policies, uint[] policyParams, address indexed creator);
    event TemplateAddress(address templateAddress);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(address templateAddress, address dataTokenAddress, address streamrConfigAddress) public initializer {
        streamrConfig = StreamrConfig(streamrConfigAddress);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        tokenAddress = dataTokenAddress;
        sponsorshipContractTemplate = templateAddress;
        emit TemplateAddress(templateAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal onlyRole(UPGRADER_ROLE) override {}

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function updateTemplate(address templateAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        sponsorshipContractTemplate = templateAddress;
        emit TemplateAddress(templateAddress);
    }

    function addTrustedPolicy(address policyAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedPolicies[policyAddress] = true;
    }

    function addTrustedPolicies(address[] memory policyAddresses) public onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = 0; i < policyAddresses.length; i++) {
            addTrustedPolicy(policyAddresses[i]);
        }
    }

    function removeTrustedPolicy(address policyAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedPolicies[policyAddress] = false;
    }

    function isTrustedPolicy(address policyAddress) public view returns (bool) {
        return trustedPolicies[policyAddress];
    }

    function onTokenTransfer(address from, uint amount, bytes calldata param) external {
        (
            uint minOperatorCount,
            string memory streamId,
            string memory metadata,
            address[] memory policies,
            uint[] memory policyParams
        ) = abi.decode(param, (uint, string, string, address[], uint[]));
        address sponsorshipAddress = _deploySponsorship(
            minOperatorCount,
            streamId,
            metadata,
            policies,
            policyParams
        );
        emit NewSponsorship(sponsorshipAddress, streamId, metadata, policies, policyParams, from);
        IERC677(tokenAddress).transferAndCall(sponsorshipAddress, amount, ""); // empty extra-data => sponsor
    }

    /**
     * Policies array is interpreted as follows:
     *   0: allocation policy (mandatory!)
     *   1: leave policy (address(0) for none)
     *   2: kick policy (address(0) for none)
     *   3+: join policies (leave out if none)
     * @param policies smart contract addresses found in the trustedPolicies
     */
    function deploySponsorship(
        uint minOperatorCount,
        string calldata streamId,
        string calldata metadata,
        address[] calldata policies,
        uint[] calldata policyParams
    ) external returns (address) {
        address sponsorshipAddress = _deploySponsorship(
            minOperatorCount,
            streamId,
            metadata,
            policies,
            policyParams
        );
        emit NewSponsorship(sponsorshipAddress, streamId, metadata, policies, policyParams, _msgSender());
        return sponsorshipAddress;
    }

    function _deploySponsorship(
        uint minOperatorCount,
        string memory streamId,
        string memory metadata,
        address[] memory policies,
        uint[] memory policyParams
    ) private returns (address) {
        IStreamRegistryV4 streamRegistry = IStreamRegistryV4(streamrConfig.streamRegistryAddress());
        if (!streamRegistry.exists(streamId)) { revert StreamNotFound(); }
        if (policies.length != policyParams.length) { revert BadArguments(); }
        if (policies.length == 0 || policies[0] == address(0)) { revert AllocationPolicyRequired(); }
        for (uint i = 0; i < policies.length; i++) {
            address policyAddress = policies[i];
            if (policyAddress != address(0) && !isTrustedPolicy(policyAddress)) { revert PolicyNotTrusted(); }
        }
        address sponsorshipAddress = ClonesUpgradeable.clone(sponsorshipContractTemplate);
        Sponsorship sponsorship = Sponsorship(sponsorshipAddress);
        // disable the minHorizonSeconds feature for now, set to zero
        uint[3] memory sponsorshipParams = [0, minOperatorCount, policyParams[0]];
        sponsorship.initialize(
            streamId,
            metadata,
            streamrConfig,
            tokenAddress,
            sponsorshipParams,
            IAllocationPolicy(policies[0])
        );
        if (policies.length > 1 && policies[1] != address(0)) { // TODO: add tests for short policies arrays
            sponsorship.setLeavePolicy(ILeavePolicy(policies[1]), policyParams[1]);
        }
        if (policies.length > 2 && policies[2] != address(0)) { // TODO: add tests for short policies arrays
            sponsorship.setKickPolicy(IKickPolicy(policies[2]), policyParams[2]);
        }
        for (uint i = 3; i < policies.length; i++) {
            if (policies[i] != address(0)) {
                sponsorship.addJoinPolicy(IJoinPolicy(policies[i]), policyParams[i]);
            }
        }
        sponsorship.addJoinPolicy(IJoinPolicy(streamrConfig.operatorContractOnlyJoinPolicy()), 0);
        sponsorship.renounceRole(sponsorship.DEFAULT_ADMIN_ROLE(), address(this));
        deploymentTimestamp[sponsorshipAddress] = block.timestamp; // solhint-disable-line not-rely-on-time
        return sponsorshipAddress;
    }

    function isTrustedForwarder(address forwarder) public view override(ERC2771ContextUpgradeable) returns (bool) {
        return streamrConfig.trustedForwarder() == forwarder;
    }
}
