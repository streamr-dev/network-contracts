
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;


import "./IBrokerPool.sol";
import "./IERC677.sol";

interface IBrokerPoolFactory {


    function initialize(address templateAddress, address _tokenAddress, address constants) external;

    function addTrustedPolicy(address policyAddress) external;

    function addTrustedPolicies(address[] calldata policyAddresses) external;

    function removeTrustedPolicy(address policyAddress) external;

    function isTrustedPolicy(address policyAddress) external view returns (bool);
    function deployBrokerPool(
        uint32 initialMinWeiInvestment,
        string calldata poolName,
        address[3] calldata policies,
        uint[8] calldata initParams
    ) external returns (address);

    function predictAddress(string calldata poolName) external view returns (address);
    function isStreamrBrokerPool(address) external view returns (bool);
    function deployedBrokerPoolsLength() external view returns (uint);
    function deployedBrokerPools(uint) external view returns (IBrokerPool);
}