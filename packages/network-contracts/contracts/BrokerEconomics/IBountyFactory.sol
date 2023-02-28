// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;


interface IBountyFactory {
    function addTrustedPolicy(address policyAddress) external;
    function addTrustedPolicies(address[] memory policyAddresses) external;
    function removeTrustedPolicy(address policyAddress) external;
    function isTrustedPolicy(address policyAddress) external view returns (bool);

    function isStreamrBounty(address) external view returns (bool); // zero for contracts not deployed by this factory

    function onTokenTransfer(address sender, uint amount, bytes calldata param) external;
    
    function deployBountyAgreement(
        uint32 initialMinHorizonSeconds,
        uint32 initialMinBrokerCount,
        string memory bountyName,
        address[] memory policies,
        uint[] memory initParams
    ) external returns (address);
}
