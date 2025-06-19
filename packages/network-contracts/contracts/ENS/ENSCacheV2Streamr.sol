/**
 * Deployed on 2021-01-11 to 0x870528c1aDe8f5eB4676AA2d15FC0B034E276A1A
 */

// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable-4.4.2/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/UUPSUpgradeable.sol";

interface IStreamRegistry {
    // solhint-disable-next-line func-name-mixedcase
    function ENScreateStreamCallback(address requestorAddress, string memory ensName, string calldata streamIdPath, string calldata metadataJsonString) external;
}

contract ENSCacheV2Streamr is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    event RequestENSOwnerAndCreateStream(string ensName, string streamIdPath, string metadataJsonString, address requestorAddress);

    mapping(string => address) public owners;
    address public streamrScript;
    IStreamRegistry public streamRegistry;

    modifier onlyStreamr() {
        require(msg.sender == address(streamrScript), "onlyStreamrScript");
        _;
    }

    modifier onlyStreamRegistry() {
        require(msg.sender == address(streamRegistry), "onlyStreamRegistry");
        _;
    }

    constructor() {
    }

    function initialize(address _streamrScript, IStreamRegistry _streamRegistry) public initializer {
        __Ownable_init();
        streamrScript = _streamrScript;
        streamRegistry = _streamRegistry;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function setStreamRegistry(address streamRegistryAddress) public onlyOwner {
        streamRegistry = IStreamRegistry(streamRegistryAddress);
    }

    function setStreamrScript(address _streamrScript) public onlyOwner {
        streamrScript = _streamrScript;
    }

    /** Update cache and create a stream */
    function requestENSOwnerAndCreateStream(
        string calldata ensName,
        string calldata streamIdPath,
        string calldata metadataJsonString,
        address requestorAddress
    ) public onlyStreamRegistry() {
        emit RequestENSOwnerAndCreateStream(ensName, streamIdPath, metadataJsonString, requestorAddress);
    }

    function fulfillENSOwner(string calldata ensName, string calldata streamIdPath, string calldata metadataJsonString, address ownerAddress) public onlyStreamr() {
        owners[ensName] = ownerAddress;
        streamRegistry.ENScreateStreamCallback(ownerAddress, ensName, streamIdPath, metadataJsonString);
    }
}
