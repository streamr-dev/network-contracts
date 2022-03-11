pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./Bounty.sol";

contract BountyFactory is  Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable  {

    address public bountyContractTemplate;
    address public streamBrokerRegistryAddress;
    address public tokenAddress;
    address private trustedForwarder;
    mapping(string => address) joinPolicies;
    mapping(string => address) leavePolicies;
    mapping(string => address) allocationPolicies;

    event NewBounty(address bountyContract);

    function initialize(address trustedForwarderAddress, address _tokenAddress) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        tokenAddress = _tokenAddress;
        trustedForwarder = trustedForwarderAddress;
    }

    function _authorizeUpgrade(address) internal override {}


     function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function deployBountyAgreement(uint initialAllocationWeiPerSecond,
        uint initialMinBrokerCount,
        uint initialMaxBrokerCount,
        uint initialMinimumStakeWei,
        uint initialMinHorizonSeconds,
        address _joinPolicy,
        address _leavePolicy,
        address _allocationPolicy
    ) public returns (address) {
        // BountyAgreement bountyAgreement = BountyAgreement(_msgSender());
        // ClonesUpgradeable.clone(bountyContractTemplate);
        // StreamAgreement streamAgreement = StreamAgreement(_msgSender());
        // StreamAgreement streamAgreement = new StreamAgreement(this);
        address bountyAddress = ClonesUpgradeable.clone(bountyContractTemplate);
        Bounty bounty = Bounty(bountyAddress);
        bounty.initialize(tokenAddress, initialAllocationWeiPerSecond, initialMinBrokerCount,
            initialMaxBrokerCount, initialMinimumStakeWei, initialMinHorizonSeconds,
            _joinPolicy, _leavePolicy, _allocationPolicy, trustedForwarder);
        emit NewBounty(bountyAddress);
        return bountyAddress;
    }
}