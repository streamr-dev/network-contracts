// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./Bounty.sol";
import "../IERC677.sol";

import "hardhat/console.sol";

contract BountyFactory is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable  {

    StreamrConstants public streamrConstants;
    address public bountyContractTemplate;
    address public tokenAddress;
    mapping(address => bool) public trustedPolicies;
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    event NewBounty(address bountyContract);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(address templateAddress, address _tokenAddress, address constants) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        tokenAddress = _tokenAddress;
        bountyContractTemplate = templateAddress;
        streamrConstants = StreamrConstants(constants);
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

    function onTokenTransfer(address sender, uint amount, bytes calldata param) external {
        (
            uint32 initialMinHorizonSeconds,
            uint32 initialMinBrokerCount,
            string memory bountyName,
            address[] memory policies,
            uint[] memory initParams
        ) = abi.decode(param,
            (uint32,uint32,string,address[],uint[])
        );
        address bountyAddress = _deployBountyAgreement(
            sender,
            initialMinHorizonSeconds,
            initialMinBrokerCount,
            bountyName,
            policies,
            initParams
        );
        IERC677(tokenAddress).transferAndCall(bountyAddress, amount, "");
    }

    /**
     * Policies array is interpreted as follows:
     *   0: allocation policy (address(0) for none)
     *   1: leave policy (address(0) for none)
     *   2: kick policy (address(0) for none)
     *   3+: join policies (leave out if none)
     * @param policies smart contract addresses found in the trustedPolicies
     */
    function deployBountyAgreement(
        uint32 initialMinHorizonSeconds,
        uint32 initialMinBrokerCount,
        string memory bountyName,
        address[] memory policies,
        uint[] memory initParams
    ) public returns (address) {
        return _deployBountyAgreement(
            _msgSender(),
            initialMinHorizonSeconds,
            initialMinBrokerCount,
            bountyName,
            policies,
            initParams
        );
    }

    function _deployBountyAgreement(
        address bountyOwner,
        uint32 initialMinHorizonSeconds,
        uint32 initialMinBrokerCount,
        string memory bountyName,
        address[] memory policies,
        uint[] memory initParams
    ) private returns (address) {
        require(policies.length == initParams.length, "error_badArguments");
        for (uint i = 0; i < policies.length; i++) {
            address policyAddress = policies[i];
            require(policyAddress == address(0) || isTrustedPolicy(policyAddress), "error_policyNotTrusted");
        }
        bytes32 salt = keccak256(abi.encode(bytes(bountyName), _msgSender()));
        address bountyAddress = ClonesUpgradeable.cloneDeterministic(bountyContractTemplate, salt);
        Bounty bounty = Bounty(bountyAddress);
        bounty.initialize(
            streamrConstants,
            address(this), // this is needed in order to set the policies
            tokenAddress,
            initialMinHorizonSeconds,
            initialMinBrokerCount
        );
        if (policies[0] != address(0)) {
            bounty.setAllocationPolicy(IAllocationPolicy(policies[0]), initParams[0]);
        }
        if (policies[1] != address(0)) {
            bounty.setLeavePolicy(ILeavePolicy(policies[1]), initParams[1]);
        }
        if (policies[2] != address(0)) {
            bounty.setKickPolicy(IKickPolicy(policies[2]), initParams[2]);
        }
        for (uint i = 3; i < policies.length; i++) {
            if (policies[i] != address(0)) {
                bounty.addJoinPolicy(IJoinPolicy(policies[i]), initParams[i]);
            }
        }
        bounty.grantRole(bounty.ADMIN_ROLE(), bountyOwner);
        bounty.renounceRole(bounty.DEFAULT_ADMIN_ROLE(), address(this));
        bounty.renounceRole(bounty.ADMIN_ROLE(), address(this));
        emit NewBounty(bountyAddress);
        return bountyAddress;
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }
}