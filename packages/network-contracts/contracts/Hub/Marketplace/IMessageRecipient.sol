// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IMessageRecipient {
    function handle(
        uint32 _origin, // the chain id of the remote chain. Unique id assigned by Hyperlane (the same as the chainId in the EIP-155).
        bytes32 _sender, // the contract address on the remote chain (e.g. RemoteMarketplace). It must match or the message will revert
        bytes calldata _message // encoded purchase info
    ) external;
}
