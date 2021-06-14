// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "../chainlinkClient/ENSCache.sol";
// import "./ERC2771Context.sol";

contract StreamRegistry is ERC2771Context {
    event StreamCreated(string id, string metadata);
    event StreamDeleted(string id);
    event StreamUpdated(string id, string metadata);
    event PermissionUpdated(string streamId, address user, bool edit, bool canDelete, bool publish, bool subscribed, bool share);

    enum PermissionType { Edit, Delete, Publish, Subscribe, Share }

    address public migrator;
    bool public migrationActive = true;
    mapping (string => uint32) private streamIdToVersion;
    mapping (string => string) public streamIdToMetadata;
    // streamid ->  keccak256(version, useraddress); -> permissions struct 
    mapping (string => mapping(bytes32 => Permission)) public streamIdToPermissions;
    ENSCache private ensCache;

    struct Permission {
        bool edit;
        bool canDelete;
        bool publish; 
        bool subscribed;
        bool share;
    }

    modifier canShare(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].share, "error_noSharePermission"); //||
        _;
    }
    modifier canShareOrRevokeOwn(string calldata streamId, address user) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].share ||
            _msgSender() == user, "error_noSharePermission"); //||
        _;
    }
    modifier canDelete(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].canDelete, "error_noDeletePermission"); //||
        _;
    }
    modifier canEdit(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].edit, "error_noEditPermission"); //||
        _;
    }
    modifier streamExists(string calldata streamId) {
        // TODO can stream exist without metadata?
        require(bytes(streamIdToMetadata[streamId]).length != 0, "error_streamDoesNotExist");
        _;
    }
    modifier isMigrator() {
        require(_msgSender() == migrator, "error_mustBeMigrator");
        _;
    }
    modifier migrationIsActive() {
        require(migrationActive, "error_migrationIsClosed");
        _;
    }
   
    constructor(address ensCacheAddr, address migratoraddr, address trustedForwarderAddress) ERC2771Context(trustedForwarderAddress) {
        // trustedForwarder = trustedForwarderAddress;
        ensCache = ENSCache(ensCacheAddr);
        migrator = migratoraddr;
    }

    function createStream(string calldata streamIdPath, string calldata metadataJsonString) public {
        string memory ownerstring = addressToString(_msgSender());
        _createStreamAndPermission(ownerstring, streamIdPath, metadataJsonString);
    }

    function createStreamWithENS(string calldata ensName, string calldata streamIdPath, string calldata metadataJsonString) public {
        require(ensCache.owners(ensName) == _msgSender(), "error_notOwnerOfENSName");
        _createStreamAndPermission(ensName, streamIdPath, metadataJsonString);
    }

    function _createStreamAndPermission(string memory ownerstring, string calldata streamIdPath, string calldata metadataJsonString) internal {
        bytes memory pathBytes = bytes(streamIdPath);
        require(pathBytes[0] == "/", "error_pathMustStartWithSlash");
        string memory streamId = string(abi.encodePacked(ownerstring, streamIdPath));
        require(bytes(streamIdToMetadata[streamId]).length == 0, "error_streamAlreadyExists");
        streamIdToVersion[streamId] = streamIdToVersion[streamId] + 1;
        streamIdToMetadata[streamId] = metadataJsonString;
        streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())] = 
        Permission({
            edit: true,
            canDelete: true,
            publish: true,
            subscribed: true,
            share: true
        });
        emit StreamCreated(streamId, metadataJsonString);
        emit PermissionUpdated(streamId, _msgSender(), true, true, true, true, true);
    }

    function getAddressKey(string memory streamId, address user) public view returns (bytes32) {
        return keccak256(abi.encode(streamIdToVersion[streamId], user));
    }

    function updateStreamMetadata(string calldata streamId, string calldata metadata) public streamExists(streamId) canEdit(streamId) {
        streamIdToMetadata[streamId] = metadata;
        emit StreamUpdated(streamId, metadata);
    }

    function getStreamMetadata(string calldata streamId) public view streamExists(streamId) returns (string memory des) {
        return streamIdToMetadata[streamId];
    }

    function deleteStream(string calldata streamId) public streamExists(streamId) canDelete(streamId) {
        delete streamIdToMetadata[streamId];
        emit StreamDeleted(streamId);
    }

    function getPermissionsForUser(string calldata streamId, address user) public view streamExists(streamId) returns (Permission memory permission) {
        permission = streamIdToPermissions[streamId][getAddressKey(streamId, user)];
        Permission memory publicPermission = streamIdToPermissions[streamId][getAddressKey(streamId, address(0))];
        permission.publish = permission.publish || publicPermission.publish;
        permission.subscribed = permission.subscribed || publicPermission.subscribed;
        return permission;
    }

    function getDirectPermissionsForUser(string calldata streamId, address user) public view streamExists(streamId) returns (Permission memory permission) {
        return streamIdToPermissions[streamId][getAddressKey(streamId, user)];
    }

    function setPermissionsForUser(string calldata streamId, address user, bool edit, 
        bool deletePerm, bool publish, bool subscribe, bool share) public canShare(streamId) {
            _setPermissionBooleans(streamId, user, edit, deletePerm, publish, subscribe, share);
    }

    function _setPermissionBooleans(string calldata streamId, address user, bool edit, 
        bool deletePerm, bool publish, bool subscribe, bool share) private {
        require(user != address(0) || !(edit || deletePerm || share),
            "error_publicCanOnlySubsPubl");
        streamIdToPermissions[streamId][getAddressKey(streamId, user)] = Permission({
            edit: edit,
            canDelete: deletePerm,
            publish: publish,
            subscribed: subscribe,
            share: share
        });
        emit PermissionUpdated(streamId, user, edit, deletePerm, publish, subscribe, share);
    }

    function revokeAllPermissionsForUser(string calldata streamId, address user) public canShareOrRevokeOwn(streamId, user){
        delete streamIdToPermissions[streamId][getAddressKey(streamId, user)];
        emit PermissionUpdated(streamId, user, false, false, false, false, false);
    }

    function hasPermission(string calldata streamId, address user, PermissionType permissionType) public view returns (bool userHasPermission) {
        return hasDirectPermission(streamId, user, permissionType) ||
            hasDirectPermission(streamId, address(0), permissionType);
    }

    function hasDirectPermission(string calldata streamId, address user, PermissionType permissionType) public view returns (bool userHasPermission) {
        if (permissionType == PermissionType.Edit) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].edit;
        }
        else if (permissionType == PermissionType.Delete) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].canDelete;
        }
        else if (permissionType == PermissionType.Subscribe) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].subscribed;
        }
        else if (permissionType == PermissionType.Publish) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].publish;
        }
        else if (permissionType == PermissionType.Share) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].share;
        }
    }

    function grantPermission(string calldata streamId, address user, PermissionType permissionType) public canShare(streamId) {
        _setPermission(streamId, user, permissionType, true);
    }

    function revokePermission(string calldata streamId, address user, PermissionType permissionType) public canShareOrRevokeOwn(streamId, user) {
        _setPermission(streamId, user, permissionType, false);
    }

    function _setPermission(string calldata streamId, address user, PermissionType permissionType, bool grant) private {
        require(user != address(0) || permissionType == PermissionType.Subscribe || permissionType == PermissionType.Publish,
            "error_publicCanOnlySubsPubl");
        if (permissionType == PermissionType.Edit) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].edit = grant;
        }
        else if (permissionType == PermissionType.Delete) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].canDelete = grant;
        }
        else if (permissionType == PermissionType.Subscribe) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].subscribed = grant;
        }
        else if (permissionType == PermissionType.Publish) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].publish = grant;
        }
        else if (permissionType == PermissionType.Share) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].share = grant;
        }
        Permission memory perm = streamIdToPermissions[streamId][getAddressKey(streamId, user)];
        emit PermissionUpdated(streamId, user, perm.edit, perm.canDelete, perm.publish, perm.subscribed, perm.share);
    }

    function grantPublicPermission(string calldata streamId, PermissionType permissionType) public canShare(streamId) {
        grantPermission(streamId, address(0), permissionType);
    }

    function revokePublicPermission(string calldata streamId, PermissionType permissionType) public canShare(streamId) {
        revokePermission(streamId, address(0), permissionType);
    }

    function setPublicPermission(string calldata streamId, bool publish, bool subscribe) public canShare(streamId) {
        setPermissionsForUser(streamId, address(0), false, false, publish, subscribe, false);
    }

    function transferAllPermissionsToUser(string calldata streamId, address recipient) public {
        Permission memory permSender = streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())];
        require(permSender.edit || permSender.canDelete || permSender.publish || permSender.subscribed ||
        permSender.share, "error_noPermissionToTransfer");
        Permission memory permRecipient = streamIdToPermissions[streamId][getAddressKey(streamId, recipient)];
        _setPermissionBooleans(streamId, recipient, permSender.edit || permRecipient.edit, permSender.canDelete || permRecipient.canDelete,
        permSender.publish || permRecipient.publish, permSender.subscribed || permRecipient.subscribed, 
        permSender.share || permRecipient.share);
        _setPermissionBooleans(streamId, _msgSender(), false, false, false, false, false);
    }

    function transferPermissionToUser(string calldata streamId, address recipient, PermissionType permissionType) public {
        require(hasDirectPermission(streamId, _msgSender(), permissionType), "error_noPermissionToTransfer");
        _setPermission(streamId, _msgSender(), permissionType, false);
        _setPermission(streamId, recipient, permissionType, true);
    }

    function migratorSetStream(string calldata streamId, string calldata metadata) public isMigrator() migrationIsActive() {
        streamIdToMetadata[streamId] = metadata;
        emit StreamUpdated(streamId, metadata);
    }

    function migratorSetPermissionsForUser(string calldata streamId, address user, bool edit, 
        bool deletePerm, bool publish, bool subscribe, bool share) public isMigrator() migrationIsActive() {
            _setPermissionBooleans(streamId, user, edit, deletePerm, publish, subscribe, share);
    }

    // not in current apidefinition, might speed up migratrion, needs to be tested
    // function bulkmigrate(string[] calldata streamids, address[] calldata users, string[] calldata metadatas, Permission[] calldata permissions) public isMigrator() migrationIsActive() {
    //     uint arrayLength = streamids.length;
    //     for (uint i=0; i<arrayLength; i++) {
    //         string calldata streamId = streamids[i];
    //         streamIdToMetadata[streamId] = metadatas[i];
    //         emit StreamUpdated(streamId, metadatas[i]);
    //         Permission memory permission = permissions[i];
    //         _setPermission(streamId, users[i], permission.edit, permission.canDelete, permission.publish, permission.subscribed, permission.share);
    //     }
    // }

    function setMigrationComplete() public isMigrator() migrationIsActive() {
        migrationActive = false;
    }

    function addressToString(address _address) public pure returns(string memory) {
       bytes32 _bytes = bytes32(uint256(uint160(_address)));
       bytes memory _hex = "0123456789abcdef";
       bytes memory _string = new bytes(42);
       _string[0] = "0";
       _string[1] = "x";
       for(uint i = 0; i < 20; i++) {
           _string[2+i*2] = _hex[uint8(_bytes[i + 12] >> 4)];
           _string[3+i*2] = _hex[uint8(_bytes[i + 12] & 0x0f)];
       }
       return string(_string);
    }
}
