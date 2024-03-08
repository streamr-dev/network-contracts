// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

contract ERC1271 is IERC1271 {

  // bytes4(keccak256("isValidSignature(bytes32,bytes)")
  bytes4 constant internal MAGICVALUE = 0x1626ba7e;

  /**
   * @dev Should return whether the signature provided is valid for the provided hash
   * @param _signature Signature byte array associated with _hash
   *
   * MUST return the bytes4 magic value 0x1626ba7e when function passes.
   * MUST NOT modify state (using STATICCALL for solc < 0.5, view modifier for solc > 0.5)
   * MUST allow external calls
   */
  function isValidSignature(
    bytes32,
    bytes memory _signature)
    public
    pure
    returns (bytes4 magicValue) {
        if (bytes32(_signature) == 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) {
            return MAGICVALUE;
        }
        return 0xffffffff;
    }
}
