// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IStreamRegistryV4 {
    enum PermissionType { Edit, Delete, Publish, Subscribe, Grant }
    function exists(string calldata streamId) external view returns (bool);

    function createStream(string calldata streamIdPath, string calldata metadataJsonString) external;
    function updateStreamMetadata(string calldata streamId, string calldata metadata) external;
    function grantPublicPermission(string calldata streamId, PermissionType permissionType) external;
    function grantPermission(string calldata streamId, address user, PermissionType permissionType) external;
    function revokePermission(string calldata streamId, address user, PermissionType permissionType) external;
    function addressToString(address _address) external pure returns(string memory);
}
