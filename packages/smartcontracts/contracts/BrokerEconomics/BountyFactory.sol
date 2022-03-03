pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./StreamAgreement.sol";

contract BountyFactory is  Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable  {

    address public bountyContractTemplate;
    address public streamBrokerRegistryAddress;
    address public tokenAddress;
    mapping(string => address) joinPolicies;
    mapping(string => address) leavePolicies;
    mapping(string => address) allocationPolicies;

    event NewBounty(address bountyContract);

    function initialize(address trustedForwarderAddress, address _tokenAddress) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
        tokenAddress = _tokenAddress;
    }

    function _authorizeUpgrade(address) internal override {}


     function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function deployBountyAgreement() public returns (address) {
        // BountyAgreement bountyAgreement = BountyAgreement(_msgSender());
        // ClonesUpgradeable.clone(bountyContractTemplate);
        // StreamAgreement streamAgreement = StreamAgreement(_msgSender());
        // StreamAgreement streamAgreement = new StreamAgreement(this);
        address streamAgreementAdress = ClonesUpgradeable.clone(bountyContractTemplate);
        StreamAgreement streamAgreement = StreamAgreement(streamAgreementAdress);
        streamAgreement.initialize(tokenAddress, 0, 0, 10, 1, 100);
        emit NewBounty(streamAgreementAdress);
        return streamAgreementAdress;
    }
}