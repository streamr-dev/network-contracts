
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "../token/IERC677.sol";
import "./IVoterRegistry.sol";
import "./Operator.sol";
import "./StreamrConfig.sol";

/**
 * OperatorFactory creates "smart contract interfaces" for operators to the Streamr Network.
 * Only Operators from this OperatorFactory can stake to Streamr Network Sponsorships.
 *
 * `ADMIN_ROLE()` can update the `operatorContractTemplate` address, and add/remove trusted policies, as well as upgrade this whole contract.
 */
contract OperatorFactory is Initializable, UUPSUpgradeable, AccessControlUpgradeable, ERC2771ContextUpgradeable, IVoterRegistry {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    event NewOperator(address indexed operatorAddress, address indexed operatorContractAddress);
    event TemplateAddresses(address indexed operatorTemplate, address nodeModuleTemplate, address indexed queueModuleTemplate, address indexed stakeModuleTemplate);
    event PolicyWhitelisted(address indexed policyAddress, bool indexed isWhitelisted);

    error PolicyNotTrusted();
    error OperatorAlreadyDeployed(address operatorContractAddress);
    error InvalidOperatorContract(address notAnOperatorContractAddress);
    error AlreadyLive();
    error NotLive();
    error ExchangeRatePolicyRequired();
    error NotDelegationPolicy();
    error NotExchangeRatePolicy();
    error NotUndelegationPolicy();
    error AccessDeniedDATATokenOnly();

    address public operatorTemplate;
    address public nodeModuleTemplate;
    address public queueModuleTemplate;
    address public stakeModuleTemplate;
    address public tokenAddress;
    StreamrConfig public streamrConfig;
    mapping(address => bool) public trustedPolicies;

    /** @dev zero for contracts not deployed by this factory */
    mapping(address => uint) public deploymentTimestamp;

    /** array needed for peer operator selection for VoteKickPolicy peer review */
    address[] public voters;
    /** real index in voters array +1, zero for Operators not staked in a Sponsorship */
    mapping (address => uint) public votersIndex;

    /** Owner of the Operator contract */
    mapping (address => address) public operators; // operator wallet => Operator contract address

    uint public totalStakedWei; // global total stake in Sponsorships
    mapping (address => uint) public stakedWei; // each Operator.totalStakedIntoSponsorshipsWei()

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(
        address templateAddress,
        address dataTokenAddress,
        address streamrConfigAddress,
        address nodeModuleAddress,
        address queueModuleAddress,
        address stakeModuleAddress
    ) public initializer {
        streamrConfig = StreamrConfig(streamrConfigAddress);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _setupRole(ADMIN_ROLE, _msgSender());
        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE);
        tokenAddress = dataTokenAddress;
        operatorTemplate = templateAddress;
        nodeModuleTemplate = nodeModuleAddress;
        queueModuleTemplate = queueModuleAddress;
        stakeModuleTemplate = stakeModuleAddress;
        emit TemplateAddresses(templateAddress, nodeModuleAddress, queueModuleAddress, stakeModuleAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal onlyRole(ADMIN_ROLE) override {}

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function updateTemplates(
        address templateAddress,
        address nodeModuleAddress,
        address queueModuleAddress,
        address stakeModuleAddress
    ) public onlyRole(ADMIN_ROLE) {
        operatorTemplate = templateAddress;
        nodeModuleTemplate = nodeModuleAddress;
        queueModuleTemplate = queueModuleAddress;
        stakeModuleTemplate = stakeModuleAddress;
        emit TemplateAddresses(templateAddress, nodeModuleAddress, queueModuleAddress, stakeModuleAddress);
    }

    function addTrustedPolicy(address policyAddress) public onlyRole(ADMIN_ROLE) {
        trustedPolicies[policyAddress] = true;
        emit PolicyWhitelisted(policyAddress, true);
    }

    function addTrustedPolicies(address[] calldata policyAddresses) public onlyRole(ADMIN_ROLE) {
        for (uint i; i < policyAddresses.length; i++) {
            addTrustedPolicy(policyAddresses[i]);
            emit PolicyWhitelisted(policyAddresses[i], true);
        }
    }

    function removeTrustedPolicy(address policyAddress) public onlyRole(ADMIN_ROLE) {
        trustedPolicies[policyAddress] = false;
        emit PolicyWhitelisted(policyAddress, false);
    }

    function isTrustedPolicy(address policyAddress) public view returns (bool) {
        return trustedPolicies[policyAddress];
    }

    function onTokenTransfer(address from, uint amount, bytes calldata param) external {
        if (msg.sender != tokenAddress) { revert AccessDeniedDATATokenOnly(); }
        (
            uint operatorsCutFraction,
            string memory operatorTokenName,
            string memory operatorMetadataJson,
            address[3] memory policies,
            uint[3] memory policyParams
        ) = abi.decode(param, (uint, string, string, address[3], uint[3]));
        address operatorContractAddress = _deployOperator(
            from,
            operatorsCutFraction,
            operatorTokenName,
            operatorMetadataJson,
            policies,
            policyParams
        );
        emit NewOperator(from, operatorContractAddress);
        IERC677(tokenAddress).transferAndCall(operatorContractAddress, amount, abi.encodePacked(from));
    }

    /**
     * @param operatorsCutFraction as a fraction of 10^18, like ether
     * @param policies smart contract addresses, must be in the trustedPolicies: [0] delegation, [1] exchange rate, [2] undelegation policy
     * @param policyParams not used for default policies: [0] delegation, [1] exchange rate, [2] undelegation policy param
     */
    function deployOperator(
        uint operatorsCutFraction,
        string memory operatorTokenName,
        string memory operatorMetadataJson,
        address[3] memory policies,  // [0] delegation, [1] exchange rate, [2] undelegation policy
        uint[3] memory policyParams  // [0] delegation, [1] exchange rate, [2] undelegation policy param
    ) external returns (address) {
        return _deployOperator(
            _msgSender(),
            operatorsCutFraction,
            operatorTokenName,
            operatorMetadataJson,
            policies,
            policyParams
        );
    }

    function _deployOperator(
        address operatorAddress,
        uint operatorsCutFraction,
        string memory operatorTokenName,
        string memory operatorMetadataJson,
        address[3] memory policies,
        uint[3] memory policyParams
    ) private returns (address) {
        if (operators[operatorAddress] != address(0)) {
            revert OperatorAlreadyDeployed(operators[operatorAddress]);
        }
        for (uint i; i < policies.length; i++) {
            address policyAddress = policies[i];
            if (policyAddress != address(0) && !isTrustedPolicy(policyAddress)) {
                revert PolicyNotTrusted();
            }
        }
        bytes32 salt = keccak256(abi.encode(operatorTokenName, operatorAddress));
        address newContractAddress = ClonesUpgradeable.cloneDeterministic(operatorTemplate, salt);
        Operator newOperatorContract = Operator(newContractAddress);
        newOperatorContract.initialize(
            tokenAddress,
            streamrConfig,
            operatorAddress,
            operatorTokenName,
            operatorMetadataJson,
            operatorsCutFraction,
            [nodeModuleTemplate, queueModuleTemplate, stakeModuleTemplate]
        );
        if (policies[0] != address(0)) {
            if (!IERC165(policies[0]).supportsInterface(type(IDelegationPolicy).interfaceId)) {
                revert NotDelegationPolicy();
            }
            newOperatorContract.setDelegationPolicy(IDelegationPolicy(policies[0]), policyParams[0]);
        }
        if (policies[1] != address(0)) {
            if (!IERC165(policies[1]).supportsInterface(type(IExchangeRatePolicy).interfaceId)) {
                revert NotExchangeRatePolicy();
            }
            newOperatorContract.setExchangeRatePolicy(IExchangeRatePolicy(policies[1]), policyParams[1]);
        } else {
            revert ExchangeRatePolicyRequired();
        }
        if (policies[2] != address(0)) {
            if (!IERC165(policies[2]).supportsInterface(type(IUndelegationPolicy).interfaceId)) {
                revert NotUndelegationPolicy();
            }
            newOperatorContract.setUndelegationPolicy(IUndelegationPolicy(policies[2]), policyParams[2]);
        }
        newOperatorContract.renounceRole(newOperatorContract.DEFAULT_ADMIN_ROLE(), address(this));
        deploymentTimestamp[newContractAddress] = block.timestamp; // solhint-disable-line not-rely-on-time
        emit NewOperator(operatorAddress, newContractAddress);

        operators[operatorAddress] = newContractAddress;
        return newContractAddress;
    }

    function predictAddress(address deployer, string calldata operatorTokenName) external view returns (address) {
        bytes32 salt = keccak256(abi.encode(bytes(operatorTokenName), deployer));
        return ClonesUpgradeable.predictDeterministicAddress(operatorTemplate, salt, address(this));
    }

    function isTrustedForwarder(address forwarder) public view override(ERC2771ContextUpgradeable) returns (bool) {
        return streamrConfig.trustedForwarder() == forwarder;
    }

    function voterUpdate(address operatorContractAddress) external returns (bool isEligible) {
        if (deploymentTimestamp[operatorContractAddress] == 0) {
            revert InvalidOperatorContract(operatorContractAddress);
        }
        Operator operator = Operator(operatorContractAddress);

        uint newStakeWei = operator.totalStakedIntoSponsorshipsWei();
        totalStakedWei = totalStakedWei + newStakeWei - stakedWei[operatorContractAddress];
        stakedWei[operatorContractAddress] = newStakeWei;

        uint voterThreshold = totalStakedWei * streamrConfig.minEligibleVoterFractionOfAllStake() / 1 ether;
        isEligible =
            newStakeWei >= voterThreshold &&
            deploymentTimestamp[operatorContractAddress] + streamrConfig.minEligibleVoterAge() < block.timestamp; // solhint-disable-line not-rely-on-time

        if (isEligible && votersIndex[operatorContractAddress] == 0) {
            voters.push(operatorContractAddress);
            votersIndex[operatorContractAddress] = voters.length; // real index + 1
            emit VoterUpdate(operatorContractAddress, true);
        }

        if (!isEligible && votersIndex[operatorContractAddress] > 0) {
            uint index = votersIndex[operatorContractAddress] - 1; // real index = votersIndex - 1
            address lastOperator = voters[voters.length - 1];
            voters[index] = lastOperator;
            voters.pop();
            votersIndex[lastOperator] = index + 1; // real index + 1
            delete votersIndex[operatorContractAddress];
            emit VoterUpdate(operatorContractAddress, false);
        }
    }

    function voterCount() external view returns (uint) {
        return voters.length;
    }
}
