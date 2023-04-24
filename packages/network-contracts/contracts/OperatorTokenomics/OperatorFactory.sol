
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./IOperatorLivenessRegistry.sol";
import "./Operator.sol";
import "./IERC677.sol";

/**
 * OperatorFactory creates "smart contract interfaces" for operators to the Streamr Network.
 * Only Operators from this OperatorFactory can stake to Streamr Network Sponsorships.
 */
contract OperatorFactory is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable, IOperatorLivenessRegistry {
    event NewOperator(address operatorAddress, address operatorContractAddress);
    event OperatorLivenessChanged(address operatorContractAddress, bool isLive);

    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    address public operatorTemplate;
    address public configAddress;
    address public tokenAddress;
    mapping(address => bool) public trustedPolicies;
    mapping(address => uint) public deploymentTimestamp; // zero for contracts not deployed by this factory

    // array needed for peer operator selection for VoteKickPolicy peer review
    Operator[] public liveOperators;
    mapping (Operator => uint) public liveOperatorsIndex; // real index +1, zero for Operators not staked in a Sponsorship

    mapping (address => address) public operators;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(address templateAddress, address dataTokenAddress, address streamrConfigAddress) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        configAddress = streamrConfigAddress;
        tokenAddress = dataTokenAddress;
        operatorTemplate = templateAddress;
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

    function addTrustedPolicies(address[] calldata policyAddresses) public onlyRole(DEFAULT_ADMIN_ROLE) {
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

    // function onTokenTransfer(address sender, uint amount, bytes calldata param) external {
    //     (
    //         uint32 initialMinHorizonSeconds,
    //         uint32 initialMinOperatorCount,
    //         string memory sponsorshipName,
    //         address[] memory policies,
    //         uint[] memory initParams
    //     ) = abi.decode(param,
    //         (uint32,uint32,string,address[],uint[])
    //     );
    //     address sponsorshipAddress = _deploySponsorship(
    //         sender,
    //         initialMinHorizonSeconds,
    //         initialMinOperatorCount,
    //         sponsorshipName,
    //         policies,
    //         initParams
    //     );
    //     IERC677(tokenAddress).transferAndCall(sponsorshipAddress, amount, "");
    // }

    /**
     * Policies array corresponds to the initParams array as follows:
     *  [0]: join policy => [0] initialMargin, [1] minimumMarginPercent
     *  [1]: yield policy => [2] initialMargin, [3] maintenanceMargin, [4] minimumMargin, [5] operatorShare, [6] operatorShareMaxDivert
     *  [2]: exit policy => [7]
     * @param policies smart contract addresses, must be in the trustedPolicies
     */
    function deployOperator(
        uint32 initialMinimumDelegationWei,
        string[2] calldata stringArgs, // [0] poolTokenName, [1] streamMetadata
        address[3] calldata policies,
        uint[8] calldata initParams
    ) public returns (address) {
        return _deployOperator(
            _msgSender(),
            initialMinimumDelegationWei,
            stringArgs,
            policies,
            initParams
        );
    }

    function _deployOperator(
        address operatorAddress,
        uint32 initialMinimumDelegationWei,
        string[2] calldata stringArgs,
        address[3] calldata policies,
        uint[8] calldata initParams
    ) private returns (address) {
        for (uint i = 0; i < policies.length; i++) {
            address policyAddress = policies[i];
            require(policyAddress == address(0) || isTrustedPolicy(policyAddress), "error_policyNotTrusted");
        }
        bytes32 salt = keccak256(abi.encode(bytes(stringArgs[0]), operatorAddress));
        address newContractAddress = ClonesUpgradeable.cloneDeterministic(operatorTemplate, salt);
        Operator newOperatorContract = Operator(newContractAddress);
        newOperatorContract.initialize(
            tokenAddress,
            configAddress,
            operatorAddress,
            stringArgs,
            initialMinimumDelegationWei
        );
        if (policies[0] != address(0)) {
            newOperatorContract.setDelegationPolicy(IDelegationPolicy(policies[0]), initParams[0], initParams[1]);
        }
        if (policies[1] != address(0)) {
            newOperatorContract.setYieldPolicy(IPoolYieldPolicy(policies[1]), initParams[2], initParams[3], initParams[4], initParams[5], initParams[6]);
        }
        if (policies[2] != address(0)) {
            newOperatorContract.setUndelegationPolicy(IUndelegationPolicy(policies[2]), initParams[7]);
        }
        newOperatorContract.renounceRole(newOperatorContract.DEFAULT_ADMIN_ROLE(), address(this));
        deploymentTimestamp[newContractAddress] = block.timestamp; // solhint-disable-line not-rely-on-time
        emit NewOperator(operatorAddress, newContractAddress);

        operators[operatorAddress] = newContractAddress;
        
        return newContractAddress;
    }

    function predictAddress(string calldata poolTokenName) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(bytes(poolTokenName), _msgSender()));
        return ClonesUpgradeable.predictDeterministicAddress(operatorTemplate, salt, address(this));
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }

    /** Operators MUST call this function when they stake to their first Sponsorship */
    function registerAsLive() public {
        address operatorContractAddress = _msgSender();
        require(deploymentTimestamp[operatorContractAddress] > 0, "error_onlyOperators");
        Operator operator = Operator(operatorContractAddress);
        require(liveOperatorsIndex[operator] == 0, "error_alreadyLive");

        liveOperators.push(operator);
        liveOperatorsIndex[operator] = liveOperators.length; // real index + 1

        emit OperatorLivenessChanged(operatorContractAddress, true);
    }

    /** Operators MUST call this function when they unstake from their last Sponsorship */
    function registerAsNotLive() public {
        address operatorContractAddress = _msgSender();
        require(deploymentTimestamp[operatorContractAddress] > 0, "error_onlyOperators");
        Operator operator = Operator(operatorContractAddress);
        require(liveOperatorsIndex[operator] > 0, "error_notLive");

        uint index = liveOperatorsIndex[operator] - 1; // real index = liveOperatorsIndex - 1
        Operator lastOperator = liveOperators[liveOperators.length - 1];
        liveOperators[index] = lastOperator;
        liveOperators.pop();
        liveOperatorsIndex[lastOperator] = index + 1; // real index + 1
        delete liveOperatorsIndex[operator];

        emit OperatorLivenessChanged(operatorContractAddress, false);
    }

    function liveOperatorCount() public view returns (uint) {
        return liveOperators.length;
    }
}
