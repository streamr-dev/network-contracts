// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

contract DelegatedAccessRegistry  {
    mapping(address => mapping(address => bool)) public delegatedAccess;

    constructor(){

    }

    function authorize(address _user) public {
        delegatedAccess[msg.sender][_user] = true;
    }

    function revoke(address _user) public {
        delegatedAccess[msg.sender][_user] = false;
    }

    function isAuthorized(address _user) public view returns (bool) {
        return delegatedAccess[msg.sender][_user];
    }

    function isUserAuthorized(address _owner, address _user) public view returns (bool) {
        return delegatedAccess[_owner][_user];
    }
}