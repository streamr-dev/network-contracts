/**
 * Upgraded on: 2021-02-16
 * https://polygonscan.com/tx/0x47536e57cf8db693627438373635b22fa471311acdc79be234e9fa959f7f6a62
 * DO NOT EDIT
 * Instead, make a copy with new version number
 */

// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;
/* solhint-disable not-rely-on-time */

import "@openzeppelin/contracts-upgradeable-4.4.2/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/UUPSUpgradeable.sol";
import "../ENS/ENSCache.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/Initializable.sol";

contract StreamRegistryV3 is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable {

    bytes32 public constant TRUSTED_ROLE = keccak256("TRUSTED_ROLE");
    uint256 constant public MAX_INT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    event StreamCreated(string id, string metadata);
    event StreamDeleted(string id);
    event StreamUpdated(string id, string metadata);
    event PermissionUpdated(string streamId, address user, bool canEdit, bool canDelete, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant);

    enum PermissionType { Edit, Delete, Publish, Subscribe, Grant }

    struct Permission {
        bool canEdit;
        bool canDelete;
        uint256 publishExpiration;
        uint256 subscribeExpiration;
        bool canGrant;
    }

    // streamid -> keccak256(version, useraddress) -> permission struct above
    mapping (string => mapping(bytes32 => Permission)) public streamIdToPermissions;
    mapping (string => string) public streamIdToMetadata;
    ENSCache private ensCache;

    // incremented when stream is (re-)created, so that users from old streams with same don't re-appear in the new stream (if they have permissions)
    mapping (string => uint32) private streamIdToVersion;

    modifier hasGrantPermission(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].canGrant, "error_noSharePermission"); //||
        _;
    }
    modifier hasSharePermissionOrIsRemovingOwn(string calldata streamId, address user) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].canGrant ||
            _msgSender() == user, "error_noSharePermission"); //||
        _;
    }
    modifier hasDeletePermission(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].canDelete, "error_noDeletePermission"); //||
        _;
    }
    modifier hasEditPermission(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())].canEdit, "error_noEditPermission"); //||
        _;
    }
    modifier streamExists(string calldata streamId) {
        require(exists(streamId), "error_streamDoesNotExist");
        _;
    }
    modifier isTrusted() {
        require(hasRole(TRUSTED_ROLE, _msgSender()), "error_mustBeTrustedRole");
        _;
    }

    // Constructor can't be used with upgradeable contracts, so use initialize instead
    //    this will not be called upon each upgrade, only once during first deployment
    function initialize(address ensCacheAddr, address trustedForwarderAddress) public initializer {
        ensCache = ENSCache(ensCacheAddr);
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
    }

    function _authorizeUpgrade(address) internal override isTrusted() {}


     function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    function setEnsCache(address ensCacheAddr) public isTrusted() {
        ensCache = ENSCache(ensCacheAddr);
    }

    function createStream(string calldata streamIdPath, string calldata metadataJsonString) public {
        string memory ownerstring = addressToString(_msgSender());
        _createStreamAndPermission(_msgSender(), ownerstring, streamIdPath, metadataJsonString);
    }

    function createStreamWithENS(string calldata ensName, string calldata streamIdPath, string calldata metadataJsonString) public {
        if (ensCache.owners(ensName) == _msgSender()) {
            _createStreamAndPermission(_msgSender(), ensName, streamIdPath, metadataJsonString);
        } else {
            ensCache.requestENSOwnerAndCreateStream(ensName, streamIdPath, metadataJsonString, _msgSender());
        }
    }

    function exists(string calldata streamId) public view returns (bool) {
        return bytes(streamIdToMetadata[streamId]).length != 0;
    }

    /**
     * Called by the ENSCache when the lookup / update is complete
     */
    // solhint-disable-next-line func-name-mixedcase
    function ENScreateStreamCallback(address ownerAddress, string memory ensName, string calldata streamIdPath, string calldata metadataJsonString) public isTrusted() {
        require(ensCache.owners(ensName) == ownerAddress, "error_notOwnerOfENSName");
        _createStreamAndPermission(ownerAddress, ensName, streamIdPath, metadataJsonString);
    }

    function _createStreamAndPermission(address ownerAddress, string memory ownerstring, string calldata streamIdPath, string calldata metadataJsonString) internal {
        require(bytes(metadataJsonString).length != 0, "error_metadataJsonStringIsEmpty");

        bytes memory pathBytes = bytes(streamIdPath);
        for (uint i = 1; i < pathBytes.length; i++) {
            //       - . / 0 1 2 ... 9
            require((bytes1("-") <= pathBytes[i] && pathBytes[i] <= bytes1("9")) ||
            ((bytes1("A") <= pathBytes[i] && pathBytes[i] <= bytes1("Z"))) ||
            ((bytes1("a") <= pathBytes[i] && pathBytes[i] <= bytes1("z"))) ||
            pathBytes[i] == "_"
            , "error_invalidPathChars");
        }
        require(pathBytes[0] == "/", "error_pathMustStartWithSlash");

        // abi.encodePacked does simple string concatenation here
        string memory streamId = string(abi.encodePacked(ownerstring, streamIdPath));
        require(bytes(streamIdToMetadata[streamId]).length == 0, "error_streamAlreadyExists");

        streamIdToVersion[streamId] = streamIdToVersion[streamId] + 1;
        streamIdToMetadata[streamId] = metadataJsonString;
        streamIdToPermissions[streamId][getAddressKey(streamId, ownerAddress)] = Permission({
            canEdit: true,
            canDelete: true,
            publishExpiration: MAX_INT,
            subscribeExpiration: MAX_INT,
            canGrant: true
        });
        emit StreamCreated(streamId, metadataJsonString);
        emit PermissionUpdated(streamId, ownerAddress, true, true, MAX_INT, MAX_INT, true);
    }

    function getAddressKey(string memory streamId, address user) public view returns (bytes32) {
        return keccak256(abi.encode(streamIdToVersion[streamId], user));
    }

    function updateStreamMetadata(string calldata streamId, string calldata metadata) public streamExists(streamId) hasEditPermission(streamId) {
        streamIdToMetadata[streamId] = metadata;
        emit StreamUpdated(streamId, metadata);
    }

    function getStreamMetadata(string calldata streamId) public view streamExists(streamId) returns (string memory des) {
        return streamIdToMetadata[streamId];
    }

    function deleteStream(string calldata streamId) public streamExists(streamId) hasDeletePermission(streamId) {
        delete streamIdToMetadata[streamId];
        emit StreamDeleted(streamId);
    }

    function getPermissionsForUser(string calldata streamId, address user) public view streamExists(streamId) returns (Permission memory permission) {
        permission = streamIdToPermissions[streamId][getAddressKey(streamId, user)];
        Permission memory publicPermission = streamIdToPermissions[streamId][getAddressKey(streamId, address(0))];
        if (permission.publishExpiration < block.timestamp && publicPermission.publishExpiration >= block.timestamp) {
            permission.publishExpiration = publicPermission.publishExpiration;
        }
        if (permission.subscribeExpiration < block.timestamp && publicPermission.subscribeExpiration >= block.timestamp) {
            permission.subscribeExpiration = publicPermission.subscribeExpiration;
        }
        return permission;
    }

    function getDirectPermissionsForUser(string calldata streamId, address user) public view streamExists(streamId) returns (Permission memory permission) {
        return streamIdToPermissions[streamId][getAddressKey(streamId, user)];
    }

    function setPermissionsForUser(string calldata streamId, address user, bool canEdit,
        bool deletePerm, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant) public hasGrantPermission(streamId) {
            _setPermissionBooleans(streamId, user, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
    }

    function _setPermissionBooleans(string calldata streamId, address user, bool canEdit,
        bool deletePerm, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant) private {
        require(user != address(0) || !(canEdit || deletePerm || canGrant),
            "error_publicCanOnlySubsPubl");
        Permission memory perm = Permission({
            canEdit: canEdit,
            canDelete: deletePerm,
            publishExpiration: publishExpiration,
            subscribeExpiration: subscribeExpiration,
            canGrant: canGrant
        });
        streamIdToPermissions[streamId][getAddressKey(streamId, user)] = perm;
        _cleanUpIfAllFalse(streamId, user, perm);
        emit PermissionUpdated(streamId, user, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
    }

    function revokeAllPermissionsForUser(string calldata streamId, address user) public hasSharePermissionOrIsRemovingOwn(streamId, user){
        delete streamIdToPermissions[streamId][getAddressKey(streamId, user)];
        emit PermissionUpdated(streamId, user, false, false, 0, 0, false);
    }

    function hasPermission(string calldata streamId, address user, PermissionType permissionType) public view returns (bool userHasPermission) {
        return hasDirectPermission(streamId, user, permissionType) ||
            hasDirectPermission(streamId, address(0), permissionType);
    }

    function hasPublicPermission(string calldata streamId, PermissionType permissionType) public view returns (bool userHasPermission) {
        return hasDirectPermission(streamId, address(0), permissionType);
    }

    function hasDirectPermission(string calldata streamId, address user, PermissionType permissionType) public view returns (bool userHasPermission) {
        if (permissionType == PermissionType.Edit) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].canEdit;
        }
        else if (permissionType == PermissionType.Delete) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].canDelete;
        }
        else if (permissionType == PermissionType.Publish) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].publishExpiration >= block.timestamp;
        }
        else if (permissionType == PermissionType.Subscribe) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].subscribeExpiration >= block.timestamp;
        }
        else if (permissionType == PermissionType.Grant) {
            return streamIdToPermissions[streamId][getAddressKey(streamId, user)].canGrant;
        }
    }

    function setPermissions(string calldata streamId, address[] calldata users, Permission[] calldata permissions) public hasGrantPermission(streamId) {
        require(users.length == permissions.length, "error_invalidInputArrayLengths");
        uint arrayLength = users.length;
        for (uint i=0; i<arrayLength; i++) {
            Permission memory permission = permissions[i];
            _setPermissionBooleans(streamId, users[i], permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
            emit PermissionUpdated(streamId, users[i], permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
        }
    }

    function setPermissionsMultipleStreans(string[] calldata streamIds, address[][] calldata users, Permission[][] calldata permissions) public {
        require(users.length == permissions.length && permissions.length == streamIds.length, "error_invalidInputArrayLengths");
        uint arrayLength = streamIds.length;
        for (uint i=0; i<arrayLength; i++) {
            setPermissions(streamIds[i], users[i], permissions[i]);
        }
    }

    function grantPermission(string calldata streamId, address user, PermissionType permissionType) public hasGrantPermission(streamId) {
        _setPermission(streamId, user, permissionType, true);
    }

    function revokePermission(string calldata streamId, address user, PermissionType permissionType) public hasSharePermissionOrIsRemovingOwn(streamId, user) {
        _setPermission(streamId, user, permissionType, false);
    }

    function _setPermission(string calldata streamId, address user, PermissionType permissionType, bool grant) private {
        require(user != address(0) || permissionType == PermissionType.Subscribe || permissionType == PermissionType.Publish,
            "error_publicCanOnlySubsPubl");
        if (permissionType == PermissionType.Edit) {
           streamIdToPermissions[streamId][getAddressKey(streamId, user)].canEdit = grant;
        }
        else if (permissionType == PermissionType.Delete) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].canDelete = grant;
        }
        else if (permissionType == PermissionType.Publish) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].publishExpiration = grant ? MAX_INT : 0;
        }
        else if (permissionType == PermissionType.Subscribe) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].subscribeExpiration = grant ? MAX_INT : 0;
        }
        else if (permissionType == PermissionType.Grant) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].canGrant = grant;
        }
        Permission memory perm = streamIdToPermissions[streamId][getAddressKey(streamId, user)];
        _cleanUpIfAllFalse(streamId, user, perm);
        emit PermissionUpdated(streamId, user, perm.canEdit, perm.canDelete, perm.publishExpiration, perm.subscribeExpiration, perm.canGrant);
    }

    function _cleanUpIfAllFalse(string calldata streamId, address user, Permission memory perm) private {
        if (!perm.canEdit && !perm.canDelete && !perm.canGrant && perm.publishExpiration < block.timestamp && perm.subscribeExpiration < block.timestamp) {
            delete streamIdToPermissions[streamId][getAddressKey(streamId, user)];
        }
    }

    function setExpirationTime(string calldata streamId, address user, PermissionType permissionType, uint256 expirationTime) public hasGrantPermission(streamId) {
        require(permissionType == PermissionType.Subscribe || permissionType == PermissionType.Publish, "error_timeOnlyObPubSub");
        if (permissionType == PermissionType.Publish) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].publishExpiration = expirationTime;
        }
        else if (permissionType == PermissionType.Subscribe) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)].subscribeExpiration = expirationTime;
        }
    }

    function grantPublicPermission(string calldata streamId, PermissionType permissionType) public hasGrantPermission(streamId) {
        grantPermission(streamId, address(0), permissionType);
    }

    function revokePublicPermission(string calldata streamId, PermissionType permissionType) public hasGrantPermission(streamId) {
        revokePermission(streamId, address(0), permissionType);
    }

    function setPublicPermission(string calldata streamId, uint256 publishExpiration, uint256 subscribeExpiration) public hasGrantPermission(streamId) {
        setPermissionsForUser(streamId, address(0), false, false, publishExpiration, subscribeExpiration, false);
    }

    function transferAllPermissionsToUser(string calldata streamId, address recipient) public {
        Permission memory permSender = streamIdToPermissions[streamId][getAddressKey(streamId, _msgSender())];
        require(permSender.canEdit || permSender.canDelete || permSender.publishExpiration > 0 || permSender.subscribeExpiration > 0 ||
        permSender.canGrant, "error_noPermissionToTransfer");
        Permission memory permRecipient = streamIdToPermissions[streamId][getAddressKey(streamId, recipient)];
        uint256 publishExpiration = permSender.publishExpiration > permRecipient.publishExpiration ? permSender.publishExpiration : permRecipient.publishExpiration;
        uint256 subscribeExpiration = permSender.subscribeExpiration > permRecipient.subscribeExpiration ? permSender.subscribeExpiration : permRecipient.subscribeExpiration;
        _setPermissionBooleans(streamId, recipient, permSender.canEdit || permRecipient.canEdit, permSender.canDelete || permRecipient.canDelete,
        publishExpiration, subscribeExpiration, permSender.canGrant || permRecipient.canGrant);
        _setPermissionBooleans(streamId, _msgSender(), false, false, 0, 0, false);
    }

    function transferPermissionToUser(string calldata streamId, address recipient, PermissionType permissionType) public {
        require(hasDirectPermission(streamId, _msgSender(), permissionType), "error_noPermissionToTransfer");
        _setPermission(streamId, _msgSender(), permissionType, false);
        _setPermission(streamId, recipient, permissionType, true);
    }

    function trustedSetStreamMetadata(string calldata streamId, string calldata metadata) public isTrusted() {
        streamIdToMetadata[streamId] = metadata;
        emit StreamUpdated(streamId, metadata);
    }

    function trustedCreateStreams(string[] calldata streamIds, string[] calldata metadatas) public isTrusted() {
        uint arrayLength = streamIds.length;
        for (uint i = 0; i < arrayLength; i++) {
            streamIdToMetadata[streamIds[i]] = metadatas[i];
            emit StreamUpdated(streamIds[i], metadatas[i]);
        }
    }

    function trustedSetStreamWithPermission(
        string calldata streamId,
        string calldata metadata,
        address user,
        bool canEdit,
        bool deletePerm,
        uint256 publishExpiration,
        uint256 subscribeExpiration,
        bool canGrant
    ) public isTrusted() {
        streamIdToMetadata[streamId] = metadata;
        _setPermissionBooleans(streamId, user, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
        emit StreamUpdated(streamId, metadata);
    }

    function trustedSetPermissionsForUser(
        string calldata streamId,
        address user,
        bool canEdit,
        bool deletePerm,
        uint256 publishExpiration,
        uint256 subscribeExpiration,
        bool canGrant
    ) public isTrusted() {
        _setPermissionBooleans(streamId, user, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
    }

    function trustedSetStreams(string[] calldata streamids, address[] calldata users, string[] calldata metadatas, Permission[] calldata permissions) public isTrusted() {
        uint arrayLength = streamids.length;
        for (uint i = 0; i < arrayLength; i++) {
            string calldata streamId = streamids[i];
            streamIdToMetadata[streamId] = metadatas[i];
            Permission memory permission = permissions[i];
            _setPermissionBooleans(streamId, users[i], permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
            emit StreamCreated(streamId, metadatas[i]);
            emit PermissionUpdated(streamId, users[i], permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
        }
    }

    function trustedSetPermissions(string[] calldata streamids, address[] calldata users, Permission[] calldata permissions) public isTrusted() {
        uint arrayLength = streamids.length;
        for (uint i = 0; i < arrayLength; i++) {
            string calldata streamId = streamids[i];
            Permission memory permission = permissions[i];
            _setPermissionBooleans(streamId, users[i], permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
            emit PermissionUpdated(streamId, users[i], permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
        }
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

    function getTrustedRole() public pure returns (bytes32) {
        return TRUSTED_ROLE;
    }
}
