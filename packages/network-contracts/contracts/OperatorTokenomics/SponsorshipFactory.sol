// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./Sponsorship.sol";
import "./IERC677.sol";
import "./StreamrConfig.sol";

/**
 * SponsorshipFactory creates Sponsorships that respect Streamr Network rules and StreamrConfig.
 * Only Sponsorships from this SponsorshipFactory can be used in Streamr Network, and staked into by Operators.
 */
contract SponsorshipFactory is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable {

    StreamrConfig public streamrConfig;
    address public sponsorshipContractTemplate;
    address public tokenAddress;
    mapping(address => bool) public trustedPolicies;
    mapping(address => uint) public deploymentTimestamp; // zero for contracts not deployed by this factory
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    event NewSponsorship(address sponsorshipContract, string streamId, string metadata);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(address templateAddress, address dataTokenAddress, address streamrConfigAddress) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        tokenAddress = dataTokenAddress;
        sponsorshipContractTemplate = templateAddress;
        streamrConfig = StreamrConfig(streamrConfigAddress);
    }

    function _authorizeUpgrade(address) internal override {}


    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
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

    function onTokenTransfer(address, uint amount, bytes calldata param) external {
        (
            uint initialMinimumStakeWei,
            uint32 initialMinHorizonSeconds,
            uint32 initialMinOperatorCount,
            string memory streamId,
            string memory metadata,
            address[] memory policies,
            uint[] memory initParams
        ) = abi.decode(param,
            (uint,uint32,uint32,string,string,address[],uint[])
        );
        address sponsorshipAddress = _deploySponsorship(
            initialMinimumStakeWei,
            initialMinHorizonSeconds,
            initialMinOperatorCount,
            streamId,
            metadata,
            policies,
            initParams
        );
        IERC677(tokenAddress).transferAndCall(sponsorshipAddress, amount, "");
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
        uint initialMinimumStakeWei,
        uint32 initialMinHorizonSeconds,
        uint32 initialMinOperatorCount,
        string memory streamId,
        string memory metadata,
        address[] memory policies,
        uint[] memory initParams
    ) public returns (address) {
        return _deploySponsorship(
            initialMinimumStakeWei,
            initialMinHorizonSeconds,
            initialMinOperatorCount,
            streamId,
            metadata,
            policies,
            initParams
        );
    }

    function _deploySponsorship(
        uint initialMinimumStakeWei,
        uint initialMinHorizonSeconds,
        uint initialMinOperatorCount,
        string memory streamId,
        string memory metadata,
        address[] memory policies,
        uint[] memory initParams
    ) private returns (address) {
        require(policies.length == initParams.length, "error_badArguments");
        require(policies.length > 0 && policies[0] != address(0), "error_allocationPolicyRequired");
        require(initialMinimumStakeWei >= streamrConfig.minimumStakeWei(), "error_minimumStakeTooLow");
        for (uint i = 0; i < policies.length; i++) {
            address policyAddress = policies[i];
            require(policyAddress == address(0) || isTrustedPolicy(policyAddress), "error_policyNotTrusted");
        }
        address sponsorshipAddress = ClonesUpgradeable.clone(sponsorshipContractTemplate);
        Sponsorship sponsorship = Sponsorship(sponsorshipAddress);
        uint[4] memory sponsorshipParams = [initialMinimumStakeWei, initialMinHorizonSeconds, initialMinOperatorCount, initParams[0]];
        sponsorship.initialize(
            streamId,
            metadata,
            streamrConfig,
            tokenAddress,
            sponsorshipParams,
            IAllocationPolicy(policies[0])
        );
        if (policies.length > 1 && policies[1] != address(0)) { // TODO: add tests for short policies arrays
            sponsorship.setLeavePolicy(ILeavePolicy(policies[1]), initParams[1]);
        }
        if (policies.length > 2 && policies[2] != address(0)) { // TODO: add tests for short policies arrays
            sponsorship.setKickPolicy(IKickPolicy(policies[2]), initParams[2]);
        }
        for (uint i = 3; i < policies.length; i++) {
            if (policies[i] != address(0)) {
                sponsorship.addJoinPolicy(IJoinPolicy(policies[i]), initParams[i]);
            }
        }
        sponsorship.addJoinPolicy(IJoinPolicy(streamrConfig.operatorContractOnlyJoinPolicy()), 0);
        sponsorship.renounceRole(sponsorship.DEFAULT_ADMIN_ROLE(), address(this));
        emit NewSponsorship(sponsorshipAddress, streamId, metadata);
        // solhint-disable-next-line not-rely-on-time
        deploymentTimestamp[sponsorshipAddress] = block.timestamp;
        return sponsorshipAddress;
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }
}
