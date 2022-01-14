/**
 * Deployed on 2021-01-11 to 0x870528c1aDe8f5eB4676AA2d15FC0B034E276A1A
 */

// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/Chainlink.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IStreamRegistry {
    function ENScreateStreamCallback(address requestorAddress, string memory ensName, string calldata streamIdPath, string calldata metadataJsonString) external;
}

contract ENSCacheV1 is ChainlinkClient, Ownable {
    using Chainlink for Chainlink.Request;

    uint256 constant private ORACLE_PAYMENT = 0 * LINK_DIVISIBILITY;
    // uint256 constant private ORACLE_PAYMENT = 1;

    mapping(string => address) public owners;
    mapping(bytes32 => string) public tempENSnames;
    mapping(bytes32 => string) public tempIdPaths;
    mapping(bytes32 => string) public tempMetadatas;
    mapping(bytes32 => address) public tempRequestorAddress;

    address public oracle;
    string public jobId;
    IStreamRegistry private streamRegistry;

    constructor(address oracleAddress, string memory chainlinkJobId) ChainlinkClient() Ownable() {
        oracle = oracleAddress;
        jobId = chainlinkJobId;
    }

    function setOracleAddress(address oracleAddress) public onlyOwner {
        oracle = oracleAddress;
    }

    function setStreamRegistry(address streamRegistryAddress) public onlyOwner {
        streamRegistry = IStreamRegistry(streamRegistryAddress);
    }

    function setChainlinkTokenAddress(address _link) public onlyOwner {
        super.setChainlinkToken(_link);
    }

    function setChainlinkJobId(string calldata chainlinkJobId) public onlyOwner {
        jobId = chainlinkJobId;
    }

    /** Just update cache for ensName */
    function requestENSOwner(string calldata ensName) public {
        Chainlink.Request memory req = buildChainlinkRequest(stringToBytes32(jobId), address(this), this.fulfillENSOwner.selector);
        req.add("ensname", ensName);
        bytes32 requestid = sendChainlinkRequestTo(oracle, req, ORACLE_PAYMENT);
        tempENSnames[requestid] = ensName;
    }

    /** Update cache and create a stream */
    function requestENSOwnerAndCreateStream(string calldata ensName, string calldata streamIdPath, string calldata metadataJsonString, address requestorAddress) public {
        Chainlink.Request memory req = buildChainlinkRequest(stringToBytes32(jobId), address(this), this.fulfillENSOwner.selector);
        req.add("ensname", ensName);
        bytes32 requestid = sendChainlinkRequestTo(oracle, req, ORACLE_PAYMENT);
        tempRequestorAddress[requestid] = requestorAddress;
        tempENSnames[requestid] = ensName;
        tempIdPaths[requestid] = streamIdPath;
        tempMetadatas[requestid] = metadataJsonString;
    }

    function fulfillENSOwner(bytes32 requestId, bytes32 owneraddress) public recordChainlinkFulfillment(requestId) {
        owners[tempENSnames[requestId]] = address(uint160(uint256(owneraddress)));
        streamRegistry.ENScreateStreamCallback(tempRequestorAddress[requestId], tempENSnames[requestId], tempIdPaths[requestId], tempMetadatas[requestId]);
    }

    function getChainlinkToken() public view returns (address) {
        return chainlinkTokenAddress();
    }

    function withdrawLink() public onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(chainlinkTokenAddress());
        require(link.transfer(_msgSender(), link.balanceOf(address(this))), "Unable to transfer");
    }

    function cancelRequest(bytes32 _requestId, uint256 _payment, bytes4 _callbackFunctionId,
        uint256 _expiration) public onlyOwner {
        cancelChainlinkRequest(_requestId, _payment, _callbackFunctionId, _expiration);
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