/**
 * Polygon deployment tx hash: TODO
 *
 * Changes in V5:
 * - Added *forUserId functions: replace user as address with user as bytes calldata
 *   - this is to support permission targets longer than 20 bytes (different cryptography)
 *   - due to size concerns:
 *      - userIdHasPermission and userIdHasDirectPermission not included, can be done with getPermissionsForUserId
 *      - setPermissionsForUserId not included, can be done via setPermissionsForUserIds
 *      - createStreamWithPermissionsForUserIds not included because
 *          it's the only thing that requires getUserKeyForUserId to take memory instead of calldata,
 *          and anyway you'd probably want to give permissions to addresses upon creation probably, which is still supported
 *      - DRY refactorings: combined some internal functions to take userKey instead of address or bytes id
 * - Removed little used functions: transferAllPermissionsToUser, transferPermissionToUser
 */

// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
/* solhint-disable not-rely-on-time */

import "./ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/UUPSUpgradeable.sol";
import "../chainlinkClient/ENSCache.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/Initializable.sol";

/**
 * @title StreamRegistry
 * Streamr Network streams and associated permissions.
 *
 * Stream IDs are creator address or ENS name + path, e.g. 0x1234/my-stream or me.eth/my-stream.
 *
 * Permissions can be set for Ethereum addresses, or for arbitrary user IDs (bytes).
 */
// solhint-disable-next-line contract-name-camelcase
contract StreamRegistryV5 is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable {

    bytes32 public constant TRUSTED_ROLE = keccak256("TRUSTED_ROLE");
    uint256 constant public MAX_INT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    event StreamCreated(string id, string metadata);
    event StreamDeleted(string id);
    event StreamUpdated(string id, string metadata);
    event PermissionUpdated(string streamId, address user, bool canEdit, bool canDelete, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant);
    event PermissionUpdatedForUserId(string streamId, bytes user, bool canEdit, bool canDelete, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant);

    enum PermissionType { Edit, Delete, Publish, Subscribe, Grant }

    struct Permission {
        bool canEdit;       // only for Ethereum addresses
        bool canDelete;     // only for Ethereum addresses
        uint256 publishExpiration;
        uint256 subscribeExpiration;
        bool canGrant;      // only for Ethereum addresses
    }

    // streamid -> hash of (version + user) -> permission struct above
    // user is an Ethereum address for functions that use `getUserKey` for hashing
    //  and bytes for functions that use `getUserKeyForUserId`
    mapping (string => mapping(bytes32 => Permission)) public streamIdToPermissions;
    mapping (string => string) public streamIdToMetadata;
    ENSCache public ensCache;

    // incremented when stream is (re-)created, so that users from old streams with same don't re-appear in the new stream (if they have permissions)
    mapping (string => uint32) public streamIdToVersion;

    modifier streamExists(string calldata streamId) {
        require(exists(streamId), "error_streamDoesNotExist");
        _;
    }
    modifier hasGrantPermission(string calldata streamId) {
        require(exists(streamId), "error_streamDoesNotExist");
        require(streamIdToPermissions[streamId][getUserKey(streamId, _msgSender())].canGrant, "error_noSharePermission");
        _;
    }
    modifier hasSharePermissionOrIsRemovingOwn(string calldata streamId, address user) {
        require(exists(streamId), "error_streamDoesNotExist");
        require(
            streamIdToPermissions[streamId][getUserKey(streamId, _msgSender())].canGrant
            || _msgSender() == user,
            "error_noSharePermission"
        );
        _;
    }
    modifier hasDeletePermission(string calldata streamId) {
        require(exists(streamId), "error_streamDoesNotExist");
        require(streamIdToPermissions[streamId][getUserKey(streamId, _msgSender())].canDelete, "error_noDeletePermission");
        _;
    }
    modifier hasEditPermission(string calldata streamId) {
        require(exists(streamId), "error_streamDoesNotExist");
        require(streamIdToPermissions[streamId][getUserKey(streamId, _msgSender())].canEdit, "error_noEditPermission");
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

    //////////////////////////////////////////////////////////////////////////////////
    // STREAM MANAGEMENT
    //////////////////////////////////////////////////////////////////////////////////

    function _createStreamAndPermission(address ownerAddress, string memory ownerstring, string calldata streamIdPath, string calldata metadataJsonString) internal returns (string memory) {
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
        streamIdToPermissions[streamId][getUserKey(streamId, ownerAddress)] = Permission({
            canEdit: true,
            canDelete: true,
            publishExpiration: MAX_INT,
            subscribeExpiration: MAX_INT,
            canGrant: true
        });
        emit StreamCreated(streamId, metadataJsonString);
        emit PermissionUpdated(streamId, ownerAddress, true, true, MAX_INT, MAX_INT, true);
        return streamId;
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

    function createStreamWithPermissions(string calldata streamIdPath, string calldata metadataJsonString, address[] calldata users, Permission[] calldata permissions) public {
        string memory ownerstring = addressToString(_msgSender());
        string memory streamId = _createStreamAndPermission(_msgSender(), ownerstring, streamIdPath, metadataJsonString);
        _setPermissionsBatch(streamId, users, permissions);
    }

    function createMultipleStreamsWithPermissions(string[] calldata streamIdPaths, string[] calldata metadataJsonStrings, address[][] calldata users, Permission[][] calldata permissions) public {
        for (uint i = 0; i < streamIdPaths.length; i++) {
            createStreamWithPermissions(streamIdPaths[i], metadataJsonStrings[i], users[i], permissions[i]);
        }
    }

    function deleteStream(string calldata streamId) public hasDeletePermission(streamId) {
        delete streamIdToMetadata[streamId];
        emit StreamDeleted(streamId);
    }

    function exists(string calldata streamId) public view returns (bool) {
        return bytes(streamIdToMetadata[streamId]).length != 0;
    }

    function updateStreamMetadata(string calldata streamId, string calldata metadata) public hasEditPermission(streamId) {
        streamIdToMetadata[streamId] = metadata;
        emit StreamUpdated(streamId, metadata);
    }

    function getStreamMetadata(string calldata streamId) public view streamExists(streamId) returns (string memory des) {
        return streamIdToMetadata[streamId];
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

    //////////////////////////////////////////////////////////////////////////////////
    // PERMISSIONS MANAGEMENT
    //////////////////////////////////////////////////////////////////////////////////

    function getAddressKey(string memory streamId, address user) public view returns (bytes32) {
        return getUserKey(streamId, user);
    }
    function getUserKey(string memory streamId, address user) internal view returns (bytes32) {
        return keccak256(abi.encode(streamIdToVersion[streamId], user));
    }
    function streamIdToPublicPermissionUserKey(string memory streamId) public view returns (bytes32 userKey) {
        return getUserKey(streamId, address(0));
    }

    /**
     * Get user's permissions to stream.
     * For publish/subscribe expiration, if public permission has a longer validity, use that.
     **/
    function getPermissionsForUser(string calldata streamId, address user) public view streamExists(streamId) returns (Permission memory permission) {
        return _getPermissionsForUser(streamId, getUserKey(streamId, user));
    }

    function getDirectPermissionsForUser(string calldata streamId, address user) public view streamExists(streamId) returns (Permission memory permission) {
        return streamIdToPermissions[streamId][getUserKey(streamId, user)];
    }

    function setPermissionsForUser(
        string calldata streamId, address user, bool canEdit, bool canDelete, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant
    ) public hasGrantPermission(streamId) {
        bytes32 userKey = getUserKey(streamId, user);
        _setAllPermissions(streamId, userKey, canEdit, canDelete, publishExpiration, subscribeExpiration, canGrant);
        emit PermissionUpdated(streamId, user, canEdit, canDelete, publishExpiration, subscribeExpiration, canGrant);
    }

    function _setAllPermissions(
        string memory streamId, bytes32 userKey, bool canEdit, bool canDelete, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant
    ) private {
        bool canEditDeleteOrGrant = canEdit || canDelete || canGrant;
        if (!canEditDeleteOrGrant && publishExpiration < block.timestamp && subscribeExpiration < block.timestamp) {
            delete streamIdToPermissions[streamId][userKey];
            return;
        }
        require(!(userKey == streamIdToPublicPermissionUserKey(streamId) && canEditDeleteOrGrant), "error_publicCanOnlySubsPubl");

        Permission storage perm = streamIdToPermissions[streamId][userKey];
        perm.canEdit = canEdit;
        perm.canDelete = canDelete;
        perm.publishExpiration = publishExpiration;
        perm.subscribeExpiration = subscribeExpiration;
        perm.canGrant = canGrant;
    }

    function revokeAllPermissionsForUser(string calldata streamId, address user) public hasSharePermissionOrIsRemovingOwn(streamId, user){
        delete streamIdToPermissions[streamId][getUserKey(streamId, user)];
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
        bytes32 key = getUserKey(streamId, user);
        if (permissionType == PermissionType.Edit) {
            return streamIdToPermissions[streamId][key].canEdit;
        } else if (permissionType == PermissionType.Delete) {
            return streamIdToPermissions[streamId][key].canDelete;
        } else if (permissionType == PermissionType.Publish) {
            return streamIdToPermissions[streamId][key].publishExpiration >= block.timestamp;
        } else if (permissionType == PermissionType.Subscribe) {
            return streamIdToPermissions[streamId][key].subscribeExpiration >= block.timestamp;
        } else if (permissionType == PermissionType.Grant) {
            return streamIdToPermissions[streamId][key].canGrant;
        }
    }

    function setPermissions(string calldata streamId, address[] calldata users, Permission[] calldata permissions) external hasGrantPermission(streamId) {
        _setPermissionsBatch(streamId, users, permissions);
    }

    function _setPermissionsBatch(string memory streamId, address[] calldata users, Permission[] calldata permissions) internal {
        require(users.length == permissions.length, "error_invalidInputArrayLengths");
        uint arrayLength = users.length;
        for (uint i = 0; i < arrayLength; i++) {
            Permission memory permission = permissions[i];
            bytes32 userKey = getUserKey(streamId, users[i]);
            _setAllPermissions(streamId, userKey, permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
            emit PermissionUpdated(streamId, users[i], permission.canEdit, permission.canDelete, permission.publishExpiration, permission.subscribeExpiration, permission.canGrant);
        }
    }

    function setPermissionsMultipleStreams(string[] calldata streamIds, address[][] calldata users, Permission[][] calldata permissions) public {
        require(users.length == permissions.length && permissions.length == streamIds.length, "error_invalidInputArrayLengths");
        uint arrayLength = streamIds.length;
        for (uint i=0; i<arrayLength; i++) {
            _setPermissionsBatch(streamIds[i], users[i], permissions[i]);
        }
    }

    function grantPermission(string calldata streamId, address user, PermissionType permissionType) public hasGrantPermission(streamId) {
        bytes32 userKey = getUserKey(streamId, user);
        Permission memory perm = _setPermission(streamId, userKey, permissionType, true);
        emit PermissionUpdated(streamId, user, perm.canEdit, perm.canDelete, perm.publishExpiration, perm.subscribeExpiration, perm.canGrant);
    }

    function revokePermission(string calldata streamId, address user, PermissionType permissionType) public hasSharePermissionOrIsRemovingOwn(streamId, user) {
        bytes32 userKey = getUserKey(streamId, user);
        Permission memory perm = _setPermission(streamId, userKey, permissionType, false);
        emit PermissionUpdated(streamId, user, perm.canEdit, perm.canDelete, perm.publishExpiration, perm.subscribeExpiration, perm.canGrant);
    }

    function _setPermission(string calldata streamId, bytes32 userKey, PermissionType permissionType, bool grant) private returns (Permission memory perm) {
        bool isPubOrSub = false;
        if (permissionType == PermissionType.Edit) {
            streamIdToPermissions[streamId][userKey].canEdit = grant;
        } else if (permissionType == PermissionType.Delete) {
            streamIdToPermissions[streamId][userKey].canDelete = grant;
        } else if (permissionType == PermissionType.Publish) {
            streamIdToPermissions[streamId][userKey].publishExpiration = grant ? MAX_INT : 0;
            isPubOrSub = true;
        } else if (permissionType == PermissionType.Subscribe) {
            streamIdToPermissions[streamId][userKey].subscribeExpiration = grant ? MAX_INT : 0;
            isPubOrSub = true;
        } else if (permissionType == PermissionType.Grant) {
            streamIdToPermissions[streamId][userKey].canGrant = grant;
        }
        require(userKey != streamIdToPublicPermissionUserKey(streamId) || isPubOrSub, "error_publicCanOnlySubsPubl");

        perm = streamIdToPermissions[streamId][userKey];
        if (!perm.canEdit && !perm.canDelete && !perm.canGrant && perm.publishExpiration < block.timestamp && perm.subscribeExpiration < block.timestamp) {
            delete streamIdToPermissions[streamId][userKey];
        }
    }

    function setExpirationTime(string calldata streamId, address user, PermissionType permissionType, uint256 expirationTime) public hasGrantPermission(streamId) {
        Permission memory p = _setExpirationTime(streamId, getUserKey(streamId, user), permissionType, expirationTime);
        emit PermissionUpdated(streamId, user, p.canEdit, p.canDelete, p.publishExpiration, p.subscribeExpiration, p.canGrant);
    }
    function _setExpirationTime(string calldata streamId, bytes32 userKey, PermissionType permissionType, uint256 expirationTime) private returns (Permission memory p) {
        require(permissionType == PermissionType.Subscribe || permissionType == PermissionType.Publish, "error_timeOnlyObPubSub");
        Permission storage perm = streamIdToPermissions[streamId][userKey];
        if (permissionType == PermissionType.Publish) {
            perm.publishExpiration = expirationTime;
        } else if (permissionType == PermissionType.Subscribe) {
            perm.subscribeExpiration = expirationTime;
        }
        return perm;
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

    //////////////////////////////////////////////////////////////////////////////////
    // *forUserId functions: replace user as address with user as bytes calldata
    //////////////////////////////////////////////////////////////////////////////////

    function getUserKeyForUserId(string calldata streamId, bytes calldata user) public view returns (bytes32) {
        uint256 version32Bytes = streamIdToVersion[streamId];
        // Add the correct padding so that 20-byte addresses to become padded to 32 bytes, to remain compatible with getAddressKey function that uses abi.encode
        return keccak256(abi.encodePacked(version32Bytes, bytes12(0), user));
    }

    function grantPermissionForUserId(string calldata streamId, bytes calldata user, PermissionType permissionType) public hasGrantPermission(streamId) {
        bytes32 userKey = getUserKeyForUserId(streamId, user);
        Permission memory perm = _setPermission(streamId, userKey, permissionType, true);
        emit PermissionUpdatedForUserId(streamId, user, perm.canEdit, perm.canDelete, perm.publishExpiration, perm.subscribeExpiration, perm.canGrant);
    }

    function revokePermissionForUserId(string calldata streamId, bytes calldata user, PermissionType permissionType) public hasGrantPermission(streamId) {
        bytes32 userKey = getUserKeyForUserId(streamId, user);
        Permission memory perm = _setPermission(streamId, userKey, permissionType, false);
        emit PermissionUpdatedForUserId(streamId, user, perm.canEdit, perm.canDelete, perm.publishExpiration, perm.subscribeExpiration, perm.canGrant);
    }

    function revokeAllPermissionsForUserId(string calldata streamId, bytes calldata user) public hasGrantPermission(streamId) {
        delete streamIdToPermissions[streamId][getUserKeyForUserId(streamId, user)];
        emit PermissionUpdatedForUserId(streamId, user, false, false, 0, 0, false);
    }

    function setExpirationTimeForUserId(
        string calldata streamId, bytes calldata user, PermissionType permissionType, uint256 expirationTime
    ) public hasGrantPermission(streamId) {
        Permission memory p = _setExpirationTime(streamId, getUserKeyForUserId(streamId, user), permissionType, expirationTime);
        emit PermissionUpdatedForUserId(streamId, user, p.canEdit, p.canDelete, p.publishExpiration, p.subscribeExpiration, p.canGrant);
    }

    function setPermissionsForUserIds(string calldata streamId, bytes[] calldata users, Permission[] calldata permissions) public hasGrantPermission(streamId) {
        require(users.length == permissions.length, "error_invalidInputArrayLengths");
        uint arrayLength = users.length;
        for (uint i = 0; i < arrayLength; i++) {
            bytes32 userKey = getUserKeyForUserId(streamId, users[i]);
            Permission calldata p = permissions[i];
            _setAllPermissions(streamId, userKey, p.canEdit, p.canDelete, p.publishExpiration, p.subscribeExpiration, p.canGrant);
            emit PermissionUpdatedForUserId(streamId, users[i], p.canEdit, p.canDelete, p.publishExpiration, p.subscribeExpiration, p.canGrant);
        }
    }

    function setMultipleStreamPermissionsForUserIds(string[] calldata streamIds, bytes[][] calldata users, Permission[][] calldata permissions) public {
        require(users.length == permissions.length && permissions.length == streamIds.length, "error_invalidInputArrayLengths");
        uint arrayLength = streamIds.length;
        for (uint i = 0; i < arrayLength; i++) {
            setPermissionsForUserIds(streamIds[i], users[i], permissions[i]);
        }
    }

    // NOTE: commented out due to size concerns, can be done via setPermissionsForUserIds
    // function setPermissionsForUserId(
    //     string calldata streamId, bytes calldata user, bool canEdit, bool deletePerm, uint256 publishExpiration, uint256 subscribeExpiration, bool canGrant
    // ) public hasGrantPermission(streamId) {
    //     bytes32 userKey = getUserKeyForUserId(streamId, user);
    //     _setAllPermissions(streamId, userKey, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
    //     emit PermissionUpdatedForUserId(streamId, user, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
    // }

    /**
     * Get user's permissions to stream.
     * If direct publish/subscribe has expired while public permission is valid, use the public permission.
     * @dev since public permissions can only be publish/subscribe, the other permissions don't need to be checked (they should always be false)
     **/
    function getPermissionsForUserId(string calldata streamId, bytes calldata user) public view streamExists(streamId) returns (Permission memory permission) {
        return _getPermissionsForUser(streamId, getUserKeyForUserId(streamId, user));
    }
    function _getPermissionsForUser(string calldata streamId, bytes32 userKey) private view returns (Permission memory permission) {
        permission = streamIdToPermissions[streamId][userKey];
        Permission memory publicPermission = streamIdToPermissions[streamId][streamIdToPublicPermissionUserKey(streamId)];
        if (permission.publishExpiration < block.timestamp && publicPermission.publishExpiration >= block.timestamp) {
            permission.publishExpiration = publicPermission.publishExpiration;
        }
        if (permission.subscribeExpiration < block.timestamp && publicPermission.subscribeExpiration >= block.timestamp) {
            permission.subscribeExpiration = publicPermission.subscribeExpiration;
        }
        return permission;
    }

    function getDirectPermissionsForUserId(string calldata streamId, bytes calldata user) public view streamExists(streamId) returns (Permission memory permission) {
        return streamIdToPermissions[streamId][getUserKeyForUserId(streamId, user)];
    }

    //////////////////////////////////////////////////////////////////////////////////
    // TRUSTED_ROLE functions: admin, integrations to known other smart contracts
    //////////////////////////////////////////////////////////////////////////////////

    function _authorizeUpgrade(address) internal override isTrusted() {}

    function setEnsCache(address ensCacheAddr) public isTrusted() {
        ensCache = ENSCache(ensCacheAddr);
    }

    function setTrustedForwarder(address forwarder) public isTrusted() {
        _setTrustedForwarder(forwarder);
    }

    /** used by StreamStorageRegistry when checking if caller has the trusted role */
    function getTrustedRole() public pure returns (bytes32) {
        return TRUSTED_ROLE;
    }

    /**
     * Called by the ENSCache when the lookup / update is complete
     */
    // solhint-disable-next-line func-name-mixedcase
    function ENScreateStreamCallback(address ownerAddress, string calldata ensName, string calldata streamIdPath, string calldata metadataJsonString) public isTrusted() {
        require(ensCache.owners(ensName) == ownerAddress, "error_notOwnerOfENSName");
        _createStreamAndPermission(ownerAddress, ensName, streamIdPath, metadataJsonString);
    }

    /** used by ProjectRegistry._grantSubscribeForStream when someone subscribes to a project */
    function trustedSetPermissionsForUser(
        string calldata streamId,
        address user,
        bool canEdit,
        bool deletePerm,
        uint256 publishExpiration,
        uint256 subscribeExpiration,
        bool canGrant
    ) public isTrusted() {
        bytes32 userKey = getUserKey(streamId, user);
        _setAllPermissions(streamId, userKey, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
        emit PermissionUpdated(streamId, user, canEdit, deletePerm, publishExpiration, subscribeExpiration, canGrant);
    }

    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }
}
