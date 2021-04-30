// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.0;

contract NodeDomainNameHelper {
    event Request(address indexed requestor, string indexed ipAddress, uint port);

    function request(string memory ipAddress, uint port) public {
        emit Request(msg.sender, ipAddress, port);
    }
}