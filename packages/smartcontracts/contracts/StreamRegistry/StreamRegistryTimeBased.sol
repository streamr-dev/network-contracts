// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
/* solhint-disable not-rely-on-time */

contract StreamRegistryTimeBased {
    event StreamCreated(uint id, address owner, string metadata);
    // TODO emit differences, transfered amount or emit absolute amounts from both sides?
    event TransferedViewRights(uint streamid, address from, address to, uint amount);
    event TransferedPublishRights(uint streamid, address from, address to, uint8 amount);

    uint public rollingId = 0;
    mapping (uint => string) public streamIdToMetadata;
    // streamid ->  useraddr -> permissions struct
    mapping (uint => mapping(address => Permission)) public streamIdToPermissions;

    struct Permission {
        bool isAdmin; // has all the rights, can grant
        uint8 publishRights; // TODO do we need more that 256 sharable rights?
        // sharable view rights = stream data read permission = stream subscription
        // uint8 viewRights;
        // can edit metadata
        // bool edit; // TODO do we need edit rights different from admin? can someone edit metadato but not publish?
        // TODO how big int is neccessary for time?
        uint256 subscriptionExpirationTime;
    }

    modifier canView(uint id) {
        require(streamIdToPermissions[id][msg.sender].isAdmin ||
        // streamIdToPermissions[id][msg.sender].viewRights > 0 , "no view permission");
        streamIdToPermissions[id][msg.sender].subscriptionExpirationTime > block.timestamp , "no view permission");
        _;
    }
    modifier canEdit(uint id) {
        require(streamIdToPermissions[id][msg.sender].isAdmin, "no edit/delete permission"); //||
        _;
    }
    modifier itemExists(uint id) {
        // TODO can stream exist without metadata?
        require(bytes(streamIdToMetadata[id]).length != 0, "item doesn' exist");
        _;
    }

    // TODO do we need an external id or increment ourselves?
    function createStream(string memory desc) public {
        // require(bytes(streamIdToMetadata[id]).length == 0, "item id alreay exists!");
        rollingId = rollingId + 1;
        streamIdToMetadata[rollingId] = desc;
        streamIdToPermissions[rollingId][msg.sender] =
        Permission({
            isAdmin: true,
            publishRights: 1,
            subscriptionExpirationTime: 0
        });
        emit StreamCreated(rollingId, msg.sender, desc);
    }

    function editStream(uint id, string memory desc) public itemExists(id) canEdit(id) {
        streamIdToMetadata[id] = desc;
    }
    function deleteStream(uint id) public itemExists(id) canEdit(id) {
        delete streamIdToMetadata[id];
    }

    function getDescription(uint id) public view itemExists(id) returns (string memory des) {
        return streamIdToMetadata[id];
    }

    function transferViewTime(uint id, address recipient, uint amount) public itemExists(id) {
        require(recipient != address(0), "recipient address is 0");
        if (!streamIdToPermissions[id][msg.sender].isAdmin) {
            require(streamIdToPermissions[id][msg.sender].subscriptionExpirationTime >= amount, "no viewtime left to transfer");
            streamIdToPermissions[id][msg.sender].subscriptionExpirationTime -= amount;
        }
        uint256 recipientEndTime = streamIdToPermissions[id][recipient].subscriptionExpirationTime;
        if (recipientEndTime < block.timestamp) {
            recipientEndTime = block.timestamp;
        }
        recipientEndTime += amount;
        streamIdToPermissions[id][recipient].subscriptionExpirationTime = recipientEndTime;
        emit TransferedViewRights(id, msg.sender, recipient, amount);
    }
    function transferPublishRights(uint id, address recipient, uint8 amount) public itemExists(id) {
        require(recipient != address(0), "recipient address is 0");
        if (!streamIdToPermissions[id][msg.sender].isAdmin) {
            require(streamIdToPermissions[id][msg.sender].publishRights >= amount, "no rights left to transfer");
            streamIdToPermissions[id][msg.sender].publishRights -= amount;
        }
        streamIdToPermissions[id][recipient].publishRights += amount;
        emit TransferedPublishRights(id, msg.sender, recipient, amount);
    }

    // function grantPermissions(uint id, address user, bool[] memory _permission) public itemExists(id) canGrant(id) {
    //     permissions[id][user] = _permission;
    // }

    // function hasPermission(uint id, address user, string memory _permission) public view itemExists(id) returns (bool userPermission) {
    //     if (keccak256(bytes(_permission)) == keccak256(bytes("view"))) {
    //         return permissions[id][user][0];
    //     }
    //     else if (keccak256(bytes(_permission)) == keccak256(bytes("edit"))) {
    //         return permissions[id][user][1];
    //     }
    //     else if (keccak256(bytes(_permission)) == keccak256(bytes("grant"))) {
    //         return permissions[id][user][2];
    //     } else require(false, "use view, edit and grant");
    // }
    // function getPermissions(uint id, address user) public view itemExists(id) returns (Permission memory userHasPermission) {
    //     return streamIdToPermissions[id][user];
    // }
}
