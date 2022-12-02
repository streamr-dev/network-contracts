// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IOutbox {
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external returns (uint256);
}

/**
 * @title Streamr Remote Marketplace
 * The Remmote Marketplace through which the users on other networks can send cross-chain messages (e.g. buy products)
 */
contract RemoteMarketplace {

    uint32 destinationDomain; // the Domain ID of the source chain (e.g. polygon)
    address recipientAddress; // the address of the message sender on the source chain. It must match or the message will revert
    address outboxAddress;

    /**
     * @param _outboxAddress - hyperlane core address for the chain where RemoteMarketplace is deployed (e.g. gnosis)
     */
    constructor(address _outboxAddress) {
        outboxAddress = _outboxAddress;
    }

    /**
     * @param _destinationDomain - the chain where Marketplace is deployed and where messages are sent to. It is a unique ID assigned by hyperlane protocol (e.g. polygon)
     * @param _recipientAddress - the address for the Marketplace contract. It must have the handle() function (e.g. polygon)
     * @param _messageBody - encoded purchase info
     */
    function dispatch(uint32 _destinationDomain, address _recipientAddress, string calldata _messageBody ) public {
        IOutbox(outboxAddress).dispatch(
            _destinationDomain,
            addressToBytes32(_recipientAddress),
            bytes(_messageBody)
        );
    }

    function addressToBytes32(address _addr) public pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }
}
