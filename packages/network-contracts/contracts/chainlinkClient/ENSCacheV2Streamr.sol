/**
 * Deployed on 2021-01-11 to 0x870528c1aDe8f5eB4676AA2d15FC0B034E276A1A
 */

// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./ENSCacheV1.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract ENSCacheV2Streamr is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    
    event RequestENSOwnerAndCreateStream(string ensName, string streamIdPath, string metadataJsonString, address requestorAddress);
    
    mapping(string => address) public owners;
    address private streamrScript;
    IStreamRegistry private streamRegistry;
    ENSCacheV1 private ensCacheV1;

    modifier onlyStreamr() {
        require(msg.sender == address(streamrScript), "onlyStreamrScript");
        _;
    }

    constructor() {
    }

    function initialize(address _streamrScript, IStreamRegistry _streamRegistry, ENSCacheV1 _ensCacheV1) public initializer {
        __Ownable_init();
        streamrScript = _streamrScript;
        streamRegistry = _streamRegistry;
        ensCacheV1 = _ensCacheV1;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function setStreamRegistry(address streamRegistryAddress) public onlyOwner {
        streamRegistry = IStreamRegistry(streamRegistryAddress);
    }

    function setENSCacheV1(address ensCacheV1Address) public onlyOwner {
        ensCacheV1 = ENSCacheV1(ensCacheV1Address);
    }
    
    function setStreamrScript(address _streamrScript) public onlyOwner {
        streamrScript = _streamrScript;
    }

    /** Update cache and create a stream */
    function requestENSOwnerAndCreateStream(string calldata ensName, string calldata streamIdPath, 
        string calldata metadataJsonString, address requestorAddress) public {
        address ownerAddress = address(ensCacheV1) != address(0) ? ensCacheV1.owners(ensName) : address(0);
        if (ownerAddress == requestorAddress) {
            owners[ensName] = ownerAddress;
            streamRegistry.ENScreateStreamCallback(ownerAddress, ensName, streamIdPath, metadataJsonString);
        } else {
            emit RequestENSOwnerAndCreateStream(ensName, streamIdPath, metadataJsonString, requestorAddress);
        }
    }

    function fulfillENSOwner(string calldata ensName, string calldata streamIdPath, string calldata metadataJsonString, address ownerAddress) public onlyStreamr() {
        owners[ensName] = ownerAddress;
        streamRegistry.ENScreateStreamCallback(ownerAddress, ensName, streamIdPath, metadataJsonString);
    }


    function stringToBytes32(string memory source) private pure returns (bytes32 result) {
        bytes memory tempEmptyStringTest = bytes(source);
        if (tempEmptyStringTest.length == 0) {
            return 0x0;
        }

        assembly { // solhint-disable-line no-inline-assembly
            result := mload(add(source, 32))
        }
    }
}