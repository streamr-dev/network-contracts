
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./IBrokerPoolLivenessRegistry.sol";
import "./BrokerPool.sol";
import "./IERC677.sol";

/**
 * BrokerPoolFactory creates "smart contract interfaces" for brokers to the Streamr Network.
 * Only BrokerPools from this BrokerPoolFactory can stake to Streamr Network Sponsorships.
 */
contract BrokerPoolFactory is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable, IBrokerPoolLivenessRegistry {
    event NewBrokerPool(address poolAddress);
    event BrokerPoolLivenessChanged(address poolAddress, bool isLive);

    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    address public brokerPoolTemplate;
    address public configAddress;
    address public tokenAddress;
    mapping(address => bool) public trustedPolicies;
    mapping(address => uint) public deploymentTimestamp; // zero for contracts not deployed by this factory

    // array needed for peer broker selection for VoteKickPolicy peer review
    BrokerPool[] public liveBrokerPools;
    mapping (BrokerPool => uint) public liveBrokerPoolsIndex; // real index +1, zero for BrokerPools not staked in a Sponsorship

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(address templateAddress, address dataTokenAddress, address streamrConfigAddress) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        configAddress = streamrConfigAddress;
        tokenAddress = dataTokenAddress;
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
    //         string memory sponsorshipName,
    //         address[] memory policies,
    //         uint[] memory initParams
    //     ) = abi.decode(param,
    //         (uint32,uint32,string,address[],uint[])
    //     );
    //     address sponsorshipAddress = _deploySponsorship(
    //         sender,
    //         initialMinHorizonSeconds,
    //         initialMinBrokerCount,
    //         sponsorshipName,
    //         policies,
    //         initParams
    //     );
    //     IERC677(tokenAddress).transferAndCall(sponsorshipAddress, amount, "");
    // }

    /**
     * Policies array corresponds to the initParams array as follows:
     *  [0]: join policy => [0] initialMargin, [1] minimumMarginPercent
     *  [1]: yield policy => [2] initialMargin, [3] maintenanceMargin, [4] minimumMargin, [5] brokerShare, [6] brokerShareMaxDivert
     *  [2]: exit policy => [7]
     * @param policies smart contract addresses, must be in the trustedPolicies
     */
    function deployBrokerPool(
        uint32 initialMinimumDelegationWei,
        string[2] calldata poolParams,
        address[3] calldata policies,
        uint[8] calldata initParams
    ) public returns (address) {
        return _deployBrokerPool(
            _msgSender(),
            initialMinimumDelegationWei,
            poolParams,
            policies,
            initParams
        );
    }

    function _deployBrokerPool(
        address poolOwner,
        uint32 initialMinimumDelegationWei,
        string[2] calldata poolParams,
        address[3] calldata policies,
        uint[8] calldata initParams
    ) private returns (address) {
        for (uint i = 0; i < policies.length; i++) {
            address policyAddress = policies[i];
            require(policyAddress == address(0) || isTrustedPolicy(policyAddress), "error_policyNotTrusted");
        }
        bytes32 salt = keccak256(abi.encode(bytes(poolParams[0]), poolOwner));
        address poolAddress = ClonesUpgradeable.cloneDeterministic(brokerPoolTemplate, salt);
        BrokerPool pool = BrokerPool(poolAddress);
        pool.initialize(
            tokenAddress,
            configAddress,
            poolOwner,
            poolParams,
            initialMinimumDelegationWei
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
        pool.renounceRole(pool.DEFAULT_ADMIN_ROLE(), address(this));
        deploymentTimestamp[poolAddress] = block.timestamp; // solhint-disable-line not-rely-on-time
        emit NewBrokerPool(poolAddress);
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

    /** BrokerPools MUST call this function when they stake to their first Sponsorship */
    function registerAsLive() public {
        address poolAddress = _msgSender();
        require(deploymentTimestamp[poolAddress] > 0, "error_onlyBrokerPools");
        BrokerPool pool = BrokerPool(poolAddress);
        require(liveBrokerPoolsIndex[pool] == 0, "error_alreadyLive");

        liveBrokerPools.push(pool);
        liveBrokerPoolsIndex[pool] = liveBrokerPools.length; // real index + 1

        emit BrokerPoolLivenessChanged(poolAddress, true);
    }

    /** BrokerPools MUST call this function when they unstake from their last Sponsorship */
    function registerAsNotLive() public {
        address poolAddress = _msgSender();
        require(deploymentTimestamp[poolAddress] > 0, "error_onlyBrokerPools");
        BrokerPool pool = BrokerPool(poolAddress);
        require(liveBrokerPoolsIndex[pool] > 0, "error_notLive");

        uint index = liveBrokerPoolsIndex[pool] - 1; // real index = liveBrokerPoolsIndex - 1
        BrokerPool lastPool = liveBrokerPools[liveBrokerPools.length - 1];
        liveBrokerPools[index] = lastPool;
        liveBrokerPools.pop();
        liveBrokerPoolsIndex[lastPool] = index + 1; // real index + 1
        delete liveBrokerPoolsIndex[pool];

        emit BrokerPoolLivenessChanged(poolAddress, false);
    }

    function liveBrokerPoolCount() public view returns (uint) {
        return liveBrokerPools.length;
    }
}
