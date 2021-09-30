// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract NodeDomainNameHelper {
    event Request(address indexed requestor, string indexed ipAddress, uint port);

    function request(string memory ipAddress, uint port) public {
        emit Request(msg.sender, ipAddress, port);
    }
}