
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./IBrokerPool.sol";
import "./IBrokerPoolFactory.sol";
import "./IERC677.sol";

contract BrokerPoolFactory is IBrokerPoolFactory, Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable {

    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    address public brokerPoolTemplate;
    address public streamrConstants;
    address public tokenAddress;
    mapping(address => bool) public trustedPolicies;
    mapping(address => uint) public deploymentTimestamp; // zero for contracts not deployed by this factory

    // array needed for peer broker selection for VoteKickPolicy peer review
    IBrokerPool[] public deployedBrokerPools;
    function deployedBrokerPoolsLength() public view returns (uint) {
        return deployedBrokerPools.length;
    }

    event NewBrokerPool(address poolAddress);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(address templateAddress, address _tokenAddress, address constants) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        streamrConstants = constants;
        tokenAddress = _tokenAddress;
        brokerPoolTemplate = templateAddress;
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
    //         uint32 initialMinBrokerCount,
    //         string memory bountyName,
    //         address[] memory policies,
    //         uint[] memory initParams
    //     ) = abi.decode(param,
    //         (uint32,uint32,string,address[],uint[])
    //     );
    //     address bountyAddress = _deployBountyAgreement(
    //         sender,
    //         initialMinHorizonSeconds,
    //         initialMinBrokerCount,
    //         bountyName,
    //         policies,
    //         initParams
    //     );
    //     IERC677(tokenAddress).transferAndCall(bountyAddress, amount, "");
    // }

    /**
     * Policies array corresponds to the initParams array as follows:
     *  [0]: join policy => [0] initialMargin, [1] minimumMarginPercent
     *  [1]: yield policy => [2] initialMargin, [3] maintenanceMargin, [4] minimumMargin, [5] brokerShare, [6] brokerShareMaxDivert
     *  [2]: exit policy => [7]
     * @param policies smart contract addresses, must be in the trustedPolicies
     */
    function deployBrokerPool(
        uint32 initialMinWeiInvestment,
        string calldata poolName,
        address[3] calldata policies,
        uint[8] calldata initParams
    ) public returns (address) {
        return _deployBrokerPool(
            _msgSender(),
            initialMinWeiInvestment,
            poolName,
            policies,
            initParams
        );
    }

    function _deployBrokerPool(
        address poolOwner,
        uint32 initialMinWeiInvestment,
        string calldata poolName,
        address[3] calldata policies,
        uint[8] calldata initParams
    ) private returns (address) {
        for (uint i = 0; i < policies.length; i++) {
            address policyAddress = policies[i];
            require(policyAddress == address(0) || isTrustedPolicy(policyAddress), "error_policyNotTrusted");
        }
        bytes32 salt = keccak256(abi.encode(bytes(poolName), _msgSender()));
        address poolAddress = ClonesUpgradeable.cloneDeterministic(brokerPoolTemplate, salt);
        IBrokerPool pool = IBrokerPool(poolAddress);
        pool.initialize(
            tokenAddress,
            streamrConstants,
            _msgSender(),
            poolName,
            initialMinWeiInvestment
        );
        if (policies[0] != address(0)) {
            pool.setJoinPolicy(IPoolJoinPolicy(policies[0]), initParams[0], initParams[1]);
        }
        if (policies[1] != address(0)) {
            pool.setYieldPolicy(IPoolYieldPolicy(policies[1]), initParams[2], initParams[3], initParams[4], initParams[5], initParams[6]);
        }
        if (policies[2] != address(0)) {
            pool.setExitPolicy(IPoolExitPolicy(policies[2]), initParams[7]);
        }
        pool.grantRole(pool.getAdminRole(), poolOwner);
        pool.renounceRole(pool.getDefaultAdminRole(), address(this));
        pool.renounceRole(pool.getAdminRole(), address(this));
        emit NewBrokerPool(poolAddress);
        // solhint-disable-next-line not-rely-on-time
        deploymentTimestamp[poolAddress] = block.timestamp;
        deployedBrokerPools.push(pool);
        return poolAddress;
    }

    function predictAddress(string calldata poolName) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(bytes(poolName), _msgSender()));
        return ClonesUpgradeable.predictDeterministicAddress(brokerPoolTemplate, salt, address(this));
    }

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }

    function isStreamrBrokerPool(address poolAddress) external view returns (bool) {
         return deploymentTimestamp[poolAddress] > 0;
    }
}