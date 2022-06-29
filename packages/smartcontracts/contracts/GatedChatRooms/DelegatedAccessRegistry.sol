// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";

contract DelegatedAccessRegistry is Ownable {
    mapping(address => mapping(address => bool)) public mainToDelegatedWallets;
    mapping(address => address) private delegatedToMainWallets;

    uint256 constant public AUTHORIZE_CHALLENGE_TYPE = 0;
    uint256 constant public REVOKE_CHALLENGE_TYPE = 1;

    event Authorized(address indexed mainWallet, address delegatedWallet);
    event Revoked (address indexed mainWallet, address delegatedWallet);


    constructor() Ownable(){}

    function verifyDelegationChallenge(
        address delegatedUser_,
        uint256 actionType,
        bytes memory signature_
    ) internal view returns (bool isValid) {
        require(signature_.length == 65, "error_badSignatureLength");

        bytes32 r; bytes32 s; uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature_, 32))
            s := mload(add(signature_, 64))
            v := byte(0, mload(add(signature_, 96)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "error_badSignatureVersion");

        bytes32 messageHash = keccak256(abi.encodePacked(
            actionType, 
            _msgSender()
        ));

        return delegatedUser_ == ecrecover(messageHash, v, r, s);
    }

    function authorize(address delegatedUser_, bytes memory signature_) public {
        require(verifyDelegationChallenge(delegatedUser_, AUTHORIZE_CHALLENGE_TYPE, signature_), "Invalid challenge signature");
        mainToDelegatedWallets[_msgSender()][delegatedUser_] = true;
        delegatedToMainWallets[delegatedUser_] = _msgSender();
        emit Authorized(_msgSender(), delegatedUser_);
    }

    function revoke(address delegatedUser_, bytes memory signature_) public {
        require(verifyDelegationChallenge(delegatedUser_, REVOKE_CHALLENGE_TYPE, signature_), "Invalid challenge signature");
        mainToDelegatedWallets[_msgSender()][delegatedUser_] = false;
        delegatedToMainWallets[delegatedUser_] = address(0x0);
        emit Revoked(_msgSender(), delegatedUser_);
    }

    function isAuthorized(address delegatedUser_) public view returns (bool) {
        return mainToDelegatedWallets[_msgSender()][delegatedUser_];
    }

    function isUserAuthorized(address mainUser_, address delegatedUser_) public view returns (bool) {
        return mainToDelegatedWallets[mainUser_][delegatedUser_];
    }

    function getMainWalletFor(address delegatedUser_) public view returns (address){
        return delegatedToMainWallets[delegatedUser_];
    }
} 