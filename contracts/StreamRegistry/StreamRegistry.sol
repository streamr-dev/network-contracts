// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.3;
contract StreamRegistry {
    event StreamCreated(string id, string metadata);
    // event TransferedViewRights(uint streamid, address from, address to, uint8 amount);
    // event TransferedPublishRights(uint streamid, address from, address to, uint8 amount);

    enum PermissionType { Edit, Delete, Publish, Subscribe, Share }

    mapping (string => uint32) private streamIdToVersion;
    mapping (string => string) public streamIdToMetadata;
    // streamid ->  keccak256(version, useraddress); -> permissions struct 
    mapping (string => mapping(bytes32 => Permission)) public streamIdToPermissions;

    struct Permission {
        bool edit;
        bool canDelete;
        bool publish; 
        bool subscribed;
        bool share;
    }

    modifier canShare(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, msg.sender)].share, "no share permission"); //||
        _;
    }
    modifier canDelete(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, msg.sender)].canDelete, "no delete permission"); //||
        _;
    }
    modifier canEdit(string calldata streamId) {
        require(streamIdToPermissions[streamId][getAddressKey(streamId, msg.sender)].edit, "no edit permission"); //||
        _;
    }
    modifier streamExists(string calldata streamId) {
        // TODO can stream exist without metadata?
        require(bytes(streamIdToMetadata[streamId]).length != 0, "stream does not exist");
        _;
    }

    function createStream(string memory streamIdPath, string calldata metadataJsonString) public {
        string memory ownerstring = addressToString(msg.sender);
        string memory streamId = string(abi.encodePacked(ownerstring, streamIdPath));
        require(bytes(streamIdToMetadata[streamId]).length == 0, "stream id alreay exists");
        streamIdToVersion[streamId] = streamIdToVersion[streamId] + 1;
        streamIdToMetadata[streamId] = metadataJsonString;
        streamIdToPermissions[streamId][getAddressKey(streamId, msg.sender)] = 
        Permission({
            edit: true,
            canDelete: true,
            publish: true,
            subscribed: true,
            share: true
        });
        emit StreamCreated(streamId, metadataJsonString);
    }

    function getAddressKey(string memory streamId, address user) public view returns (bytes32) {
        return keccak256(abi.encode(streamIdToVersion[streamId], user));
    }

    function updateStreamMetadata(string calldata streamId, string calldata metadata) public streamExists(streamId) canEdit(streamId) {
        streamIdToMetadata[streamId] = metadata;
    }

    function getStreamMetadata(string calldata streamId) public view streamExists(streamId) returns (string memory des) {
        return streamIdToMetadata[streamId];
    }

    function deleteStream(string calldata streamId) public streamExists(streamId) canDelete(streamId) {
        delete streamIdToMetadata[streamId];
    }

    function getPermissionsForUser(string calldata streamId, address user) public view streamExists(streamId) returns (Permission memory permission) {
        return streamIdToPermissions[streamId][getAddressKey(streamId, user)];
    }

    function setPermissionsForUser(string calldata streamId, address user, bool edit, 
        bool canDelete, bool publish, bool subscribe, bool share) public canShare(streamId) {
            streamIdToPermissions[streamId][getAddressKey(streamId, user)] = Permission({
                edit: edit,
                canDelete: canDelete,
                publish: publish,
                subscribed: subscribe,
                share: share
           });
    }

    function revokePermissionsForUser(string calldata streamId, address user) public canShare(streamId){
        delete streamIdToPermissions[streamId][getAddressKey(streamId, user)];
    }

    function hasPermission(string calldata streamId, address user, PermissionType permissionType) public view returns (bool userHasPermission) {
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
        setPermission(streamId, user, permissionType, true);
    }

    function revokePermission(string calldata streamId, address user, PermissionType permissionType) public canShare(streamId) {
        setPermission(streamId, user, permissionType, false);
    }

    function setPermission(string calldata streamId, address user, PermissionType permissionType, bool grant) internal {
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
