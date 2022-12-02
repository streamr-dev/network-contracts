// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.9;

import 'hardhat/console.sol';

interface IMessageRecipient {
    function handle(
        uint32 _origin, // the Domain ID of the source chain
        bytes32 _sender, // the address of the message sender on the source chain. It must match or the message will revert (e.g. RemmoteMarketplace)
        bytes calldata _message
    ) external;
}



contract CrossChainRecipient is IMessageRecipient {
    event ReceivedPurchase(bytes32 productId, address buyer, uint256 subscriptionSeconds);

    modifier onlyPolygonInbox(uint32 _origin) {
        // TODO: change to polygonDomain (where the marketplaceV4 is deployed)
        // require(_origin == polygonDomain && msg.sender == polygonInbox);
        _;
    }

    /**
    * Extends project subscription purchased on a different chain.
    * @dev decode projectId, subscriber, subscriptionSeconds from _data
    * @dev msg.sender is the hyperlane mailbox address from the source chain, where MarketplaceV4 is deployed (e.g. polygon)
    * @param _origin - the chain id
    * @param _sender - the subscriber
    * @param _data - encoded data contains purchase info
    */
    function handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _data
    ) external onlyPolygonInbox(_origin) {
        console.log('handle => _origin: %s, _sender: %s, msg.sender: %s', _origin, _bytes32ToAddress(_sender), msg.sender);
        // TODO: decode _data
    }

    function _bytes32ToAddress(bytes32 _buf) private pure returns (address) {
        return address(uint160(uint256(_buf)));
    }
}
