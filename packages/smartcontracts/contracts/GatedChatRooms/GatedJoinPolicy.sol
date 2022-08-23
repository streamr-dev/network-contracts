//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "../StreamRegistry/StreamRegistryV3.sol"; 

contract GatedJoinPolicy is Ownable{
    string public streamId;

    StreamRegistryV3.PermissionType[] public permissions;

    StreamRegistryV3 public streamRegistry;

    event Accepted (address indexed user);

    constructor (
        address streamRegistryAddress,
        string memory streamId_,
        StreamRegistryV3.PermissionType[] memory permissions_
    ) Ownable() {
        streamRegistry = StreamRegistryV3(streamRegistryAddress);

        streamId = streamId_;
        permissions = permissions_;
    }


    function accept(address user_) internal {
        for (uint256 i = 0; i < permissions.length; i++) {
            streamRegistry.grantPermission(streamId, user_, permissions[i]);
        }
        emit Accepted(user_);
    }


     function splitSignature(bytes memory sig)
       public
       pure
       returns (uint8, bytes32, bytes32)
   {
       require(sig.length == 65, "Sig length mismatch");
       bytes32 r;
       bytes32 s;
       uint8 v;
       // solhint-disable-next-line
       assembly {
           // first 32 bytes, after the length prefix
           r := mload(add(sig, 32))
           // second 32 bytes
           s := mload(add(sig, 64))
           // final byte (first byte of the next 32 bytes)
           v := byte(0, mload(add(sig, 96)))
       }
     
       return (v, r, s);
   }

   function recoverSigner(bytes32 message, bytes memory sig)
       public
       pure
       returns (address)
    {
       uint8 v;
       bytes32 r;
       bytes32 s;
       (v, r, s) = splitSignature(sig);
       return ecrecover(message, v, r, s);
  }

}