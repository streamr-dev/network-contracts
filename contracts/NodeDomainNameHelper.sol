pragma solidity ^0.5.16;


contract NodeDomainNameHelper {
    event Request(address indexed requestor, string indexed ipAddress, uint port);

    function request(string memory ipAddress, uint port) public {
        emit Request(msg.sender, ipAddress, port);
    }
}