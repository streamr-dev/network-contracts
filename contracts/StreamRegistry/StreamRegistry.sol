// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.3;
contract StreamRegistry {
    event StreamCreated(string id, string metadata);
    event TransferedViewRights(uint streamid, address from, address to, uint8 amount);
    event TransferedPublishRights(uint streamid, address from, address to, uint8 amount);

    mapping (string => string) public streamIdToMetadata;
    // streamid ->  useraddr -> permissions struct 
    mapping (string => mapping(address => Permission)) public streamIdToPermissions;

    struct Permission {
        bool edit;
        bool canDelete;
        bool publish; 
        bool subscribed;
        bool share;
    }

    // modifier canView(uint id) {
    //     require(streamIdToPermissions[id][msg.sender].isAdmin ||
    //     streamIdToPermissions[id][msg.sender].viewRights > 0 , "no view permission");
    //     // TODO add check for expration time
    //     _;
    // }

    modifier canShare(string calldata id) {
        require(streamIdToPermissions[id][msg.sender].share, "no share permission"); //||
        //streamIdToPermissions[id][msg.sender].edit, "no edit permission");
        _;
    }
    modifier canDelete(string calldata id) {
        require(streamIdToPermissions[id][msg.sender].canDelete, "no delete permission"); //||
        //streamIdToPermissions[id][msg.sender].edit, "no edit permission");
        _;
    }
    modifier canEdit(string calldata id) {
        require(streamIdToPermissions[id][msg.sender].edit, "no edit permission"); //||
        //streamIdToPermissions[id][msg.sender].edit, "no edit permission");
        _;
    }
    modifier itemExists(string calldata id) {
        // TODO can stream exist without metadata?
        require(bytes(streamIdToMetadata[id]).length != 0, "item doesn' exist");
        _;
    }

    // TODO do we need an external id or increment ourselves?
    function createStream(string memory streamIdPath, string calldata metadataJsonString) public {
        // require(bytes(streamIdToMetadata[id]).length == 0, "item id alreay exists!");
        string memory ownerstring = addressToString(msg.sender);
        ownerstring = string(abi.encodePacked(ownerstring, streamIdPath));
        streamIdToMetadata[ownerstring] = metadataJsonString;
        // streamIdToPermissions[rollingId][msg.sender] = 
        // Permission({
        //     isAdmin: true,
        //     publishRights: 1,
        //     viewRights: 1,
        //     expirationTime: 0
        // });
        emit StreamCreated(ownerstring, metadataJsonString);
    }

    function editItem(string calldata id, string calldata desc) public itemExists(id) canEdit(id) {
        streamIdToMetadata[id] = desc;
    }

    function getDescription(string calldata id) public view itemExists(id) returns (string memory des) {
        return streamIdToMetadata[id];
    }

    // function transferViewRights(string id, address recipient, uint8 amount) public itemExists(id) {
    //     require(recipient != address(0), "recipient address is 0");
    //     if (!streamIdToPermissions[id][msg.sender].isAdmin) {
    //         require(streamIdToPermissions[id][msg.sender].viewRights >= amount, "no rights left to transfer");
    //         streamIdToPermissions[id][msg.sender].viewRights -= amount;
    //     }
    //     streamIdToPermissions[id][recipient].viewRights += amount;
    //     emit TransferedViewRights(id, msg.sender, recipient, amount);
    // }
    // function transferPublishRights(uint id, address recipient, uint8 amount) public itemExists(id) {
    //     require(recipient != address(0), "recipient address is 0");
    //     if (!streamIdToPermissions[id][msg.sender].isAdmin) {
    //         require(streamIdToPermissions[id][msg.sender].publishRights >= amount, "no rights left to transfer");
    //         streamIdToPermissions[id][msg.sender].publishRights -= amount;
    //     }
    //     streamIdToPermissions[id][recipient].publishRights += amount;
    //     emit TransferedPublishRights(id, msg.sender, recipient, amount);
    // }

    // // function grantPermissions(uint id, address user, bool[] memory _permission) public itemExists(id) canGrant(id) {
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
// function addressToString(address _address) public pure returns (string memory _uintAsString) {
//       uint256 _i = uint256(uint160(address(_address)));
//     //   uint _i = uint256(_address);
//       if (_i == 0) {
//           return "0";
//       }
//       uint j = _i;
//       uint len;
//       while (j != 0) {
//           len++;
//           j /= 10;
//       }
//       bytes memory bstr = new bytes(len);
//       uint k = len - 1;
//       while (_i != 0) {
//           bstr[k--] = bytes1(uint8(48 + _i % 10));
//           _i /= 10;
//       }
//       return string(bstr);
//     }
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
