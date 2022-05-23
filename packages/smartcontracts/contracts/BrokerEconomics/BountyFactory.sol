// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./Bounty.sol";

contract BountyFactory is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable  {

    address public bountyContractTemplate;
    address public streamBrokerRegistryAddress;
    address public tokenAddress;
    address public trustedForwarder;
    mapping(string => address) public joinPolicies;
    mapping(string => address) public leavePolicies;
    mapping(string => address) public allocationPolicies;

    event NewBounty(address bountyContract);

    function initialize(address templateAddress, address trustedForwarderAddress, address _tokenAddress) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        tokenAddress = _tokenAddress;
        bountyContractTemplate = templateAddress;
        trustedForwarder = trustedForwarderAddress;
    }

    function _authorizeUpgrade(address) internal override {}


    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function deployBountyAgreement(
        uint initialMinHorizonSeconds,
        uint initialMinBrokerCount,
        string memory bountyName,
        address[] memory bountyJoinPolicies,
        uint[] memory bountyJoinPolicyParams,
        address allocationPolicy,
        uint allocationPolicyParam
        // address bountyLeavePolicy,
        // uint bountyLeavePolicyParam
    ) public returns (address) {
        bytes32 salt = keccak256(abi.encode(bytes(bountyName), _msgSender()));
        // BountyAgreement bountyAgreement = BountyAgreement(_msgSender());
        // ClonesUpgradeable.clone(bountyContractTemplate);
        // StreamAgreement streamAgreement = StreamAgreement(_msgSender());
        // StreamAgreement streamAgreement = new StreamAgreement(this);
        address bountyAddress = ClonesUpgradeable.cloneDeterministic(bountyContractTemplate, salt);
        Bounty bounty = Bounty(bountyAddress);
        bounty.initialize(
            address(this),
            tokenAddress,
            initialMinHorizonSeconds,
            initialMinBrokerCount,
            trustedForwarder
        );
        for (uint i = 0; i < bountyJoinPolicies.length; i++) {
            bounty.addJoinPolicy(bountyJoinPolicies[i], bountyJoinPolicyParams[i]);
        }
        bounty.setAllocationPolicy(allocationPolicy, allocationPolicyParam);
        // bounty.setLeavePolicy(bountyLeavePolicy, bountyLeavePolicyParam);
        emit NewBounty(bountyAddress);
        return bountyAddress;
    }
}