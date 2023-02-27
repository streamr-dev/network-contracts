// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IMailbox {
    function dispatch(
        uint32 destinationDomainId, // the chain id where MarketplaceV4 is deployed and where messages are sent to
        bytes32 recipientAddress, // the address for the MarketplaceV4 contract. It must have the handle() function
        bytes calldata messageBody // encoded purchase info
    ) external returns (bytes32);
}
