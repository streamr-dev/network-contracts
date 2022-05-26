// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./Bounty.sol";
import "./IERC677.sol";

import "hardhat/console.sol";

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

    function onTokenTransfer(address sender, uint amount, bytes calldata param) external {
        // require(_msgSender() == address(token), "error_onlyTokenContract");
        // uint lengt = param.length;
        // uint initialMinHorizonSeconds = bytes32ToUint(param.slice(0, 32));
        // deployBountyAgreement(data);
        console.log("sender", sender);
        console.log("amount", amount);
        // console.log("data", param);
        console.logBytes(param);
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
        console.log("initialMinHorizonSeconds", initialMinHorizonSeconds);
        console.log("initialMinBrokerCount", initialMinBrokerCount);
        console.log("bountyName", bountyName);
        console.log("bountyJoinPolicies", bountyJoinPolicies.length);
        console.log("bountyJoinPolicyParams", bountyJoinPolicyParams.length);
        console.log("allocationPolicy", allocationPolicy);
        console.log("allocationPolicyParam", allocationPolicyParam);
        console.log("bountyLeavePolicy", bountyLeavePolicy);
        console.log("bountyLeavePolicyParam", bountyLeavePolicyParam);
        address bountyAddress = deployBountyAgreement(initialMinHorizonSeconds, initialMinBrokerCount, bountyName, 
            bountyJoinPolicies, bountyJoinPolicyParams, allocationPolicy, allocationPolicyParam, 
            bountyLeavePolicy, bountyLeavePolicyParam);
        console.log("bountyAddress", bountyAddress);
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