// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./Bounty.sol";
import "./IERC677.sol";

// import "hardhat/console.sol";

contract BountyFactory is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable  {

    address public bountyContractTemplate;
    address public streamBrokerRegistryAddress;
    address public tokenAddress;
    address public trustedForwarder;
    mapping(address => bool) public trustedPolicies;

    event NewBounty(address bountyContract);

    modifier isAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "error_mustBeTrustedRole");
        _;
    }

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

    function addTrustedPolicy(address policyAddress) public isAdmin {
        trustedPolicies[policyAddress] = true;
    }

    function addTrustedPolicies(address[] memory policyAddresses) public isAdmin {
        for (uint i = 0; i < policyAddresses.length; i++) {
            addTrustedPolicy(policyAddresses[i]);
        }
    }

    function removeTrustedPolicy(address policyAddress) public isAdmin {
        trustedPolicies[policyAddress] = false;
    }

    function isTrustedPolicy(address policyAddress) public view returns (bool) {
        return trustedPolicies[policyAddress];
    }

    function onTokenTransfer(address /*sender*/, uint amount, bytes calldata param) external {
        ( uint initialMinHorizonSeconds,
        uint initialMinBrokerCount,
        string memory bountyName,
        address[] memory bountyJoinPolicies,
        uint[] memory bountyJoinPolicyParams,
        address allocationPolicy,
        uint allocationPolicyParam,
        address bountyLeavePolicy,
        uint bountyLeavePolicyParam) = abi.decode(param,
            (uint256,uint256,string,address[],uint[],address,uint,address,uint)
        );
        address bountyAddress = deployBountyAgreement(initialMinHorizonSeconds, initialMinBrokerCount, bountyName, 
            bountyJoinPolicies, bountyJoinPolicyParams, allocationPolicy, allocationPolicyParam, 
            bountyLeavePolicy, bountyLeavePolicyParam);
        IERC677(tokenAddress).transferAndCall(bountyAddress, amount, "");
    }

    function deployBountyAgreement(
        uint initialMinHorizonSeconds,
        uint initialMinBrokerCount,
        string memory bountyName,
        address[] memory bountyJoinPolicies,
        uint[] memory bountyJoinPolicyParams,
        address allocationPolicy,
        uint allocationPolicyParam,
        address bountyLeavePolicy,
        uint bountyLeavePolicyParam
    ) public returns (address) {
        for (uint i = 0; i < bountyJoinPolicies.length; i++) {
            require(isTrustedPolicy(bountyJoinPolicies[i]), "error_joinPolicyNotTrusted");
        }
        require(isTrustedPolicy(allocationPolicy), "error_allocPolicyNotTrusted");
        require(isTrustedPolicy(bountyLeavePolicy), "error_leavePolicyNotTrusted");
        bytes32 salt = keccak256(abi.encode(bytes(bountyName), _msgSender()));
        // BountyAgreement bountyAgreement = BountyAgreement(_msgSender());
        // ClonesUpgradeable.clone(bountyContractTemplate);
        // StreamAgreement streamAgreement = StreamAgreement(_msgSender());
        // StreamAgreement streamAgreement = new StreamAgreement(this);
        address bountyAddress = ClonesUpgradeable.cloneDeterministic(bountyContractTemplate, salt);
        // Bounty bounty = ;
        (Bounty(bountyAddress)).initialize(
            address(this),
            tokenAddress,
            initialMinHorizonSeconds,
            initialMinBrokerCount,
            trustedForwarder
        );
        for (uint i = 0; i < bountyJoinPolicies.length; i++) {
            (Bounty(bountyAddress)).addJoinPolicy(bountyJoinPolicies[i], bountyJoinPolicyParams[i]);
        }
        (Bounty(bountyAddress)).setAllocationPolicy(allocationPolicy, allocationPolicyParam);
        (Bounty(bountyAddress)).setLeavePolicy(bountyLeavePolicy, bountyLeavePolicyParam);
        emit NewBounty(bountyAddress);
        return bountyAddress;
    }
}