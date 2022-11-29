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
 * The Remmote Marketplace through which the users on other networks can send cross-chain messages (e.g. buy)
 */
contract RemoteMarketplace {

    uint32 destinationDomain;
    address recipientAddress;
    address hyperlaneCoreContractAddress;

    /**
     * @param _destinationDomain - the chain where the messages are sent to. It is not the chainID, rather it is a unique ID assigned by the protocol to each chain - polygon
     * @param _recipientAddress - the receiving contract (e.g. MarketplaceV4), it needs to be a contract with the handle() function - polygon
     * @param _hyperlaneCoreContractAddress - hyperlane core contract address where the Outbox implementation is - gnosis
     */
    constructor(uint32 _destinationDomain, address _recipientAddress, address _hyperlaneCoreContractAddress) {
        destinationDomain = _destinationDomain;
        recipientAddress = _recipientAddress;
        _hyperlaneCoreContractAddress = _hyperlaneCoreContractAddress;
    }

    function dispatchMessage() public {
        IOutbox(hyperlaneCoreContractAddress).dispatch(
            destinationDomain,
            _addressToBytes32(recipientAddress),
            bytes("sent from the remote marketplace")
        );
    }

    function _addressToBytes32(address _addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }
}
