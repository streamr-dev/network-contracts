
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./BrokerPool.sol";
import "../IERC677.sol";

import "hardhat/console.sol";

contract BrokerPoolFactory is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable  {

    address public brokerPoolTemplate;
    address public streamrConstants;
    address public tokenAddress;
    mapping(address => bool) public trustedPolicies;
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    event NewBrokerPool(address poolAddress);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    function initialize(address templateAddress, address _tokenAddress, address constants) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
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
     * Policies array is interpreted as follows:
     *   0: allocation policy (address(0) for none)
     *   1: leave policy (address(0) for none)
     *   2: kick policy (address(0) for none)
     *   3+: join policies (leave out if none)
     * @param policies smart contract addresses found in the trustedPolicies
     */
    function deployBrokerPool(
        // uint32 initialMinHorizonSeconds,
        uint32 initialMinWeiInvestment,
        uint256 gracePeriodSeconds,
        string memory poolName,
        address[] memory policies,
        uint[] memory initParams
    ) public returns (address) {
        return _deployBrokerPool(
            _msgSender(),
            // initialMinHorizonSeconds,
            initialMinWeiInvestment,
            gracePeriodSeconds,
            poolName,
            policies,
            initParams
        );
    }

    function _deployBrokerPool(
        address poolOwner,
        // uint32 initialMinHorizonSeconds,
        uint32 initialMinWeiInvestment,
        uint256 gracePeriodSeconds,
        string memory poolName,
        address[] memory policies,
        uint[] memory initParams
    ) private returns (address) {
        for (uint i = 0; i < policies.length; i++) {
            address policyAddress = policies[i];
            require(policyAddress == address(0) || isTrustedPolicy(policyAddress), "error_policyNotTrusted");
        }
        bytes32 salt = keccak256(abi.encode(bytes(poolName), _msgSender()));
        address poolAddress = ClonesUpgradeable.cloneDeterministic(brokerPoolTemplate, salt);
        BrokerPool pool = BrokerPool(poolAddress);
        pool.initialize(
            // address(this), // this is needed in order to set the policies
            tokenAddress,
            streamrConstants,
            _msgSender(),
            poolName,
            // initialMinHorizonSeconds,
            // initialMinBrokerCount,
            initialMinWeiInvestment,
            gracePeriodSeconds
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
        // // for (uint i = 3; i < policies.length; i++) {
        //     // if (policies[i] != address(0)) {
        //     //     bounty.addJoinPolicy(IJoinPolicy(policies[i]), initParams[i]);
        //     // }
        // // }
        pool.grantRole(pool.ADMIN_ROLE(), poolOwner);
        pool.renounceRole(pool.DEFAULT_ADMIN_ROLE(), address(this));
        pool.renounceRole(pool.ADMIN_ROLE(), address(this));
        emit NewBrokerPool(poolAddress);
        return poolAddress;
    }

     /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }
}