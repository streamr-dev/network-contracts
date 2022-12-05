// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

interface IMessageRecipient {
  function handle(
    uint32 _origin,
    bytes32 _sender,
    bytes calldata _message
  ) external;
}

contract MockInbox {
  struct PendingMessage {
    bytes32 sender;
    bytes32 recipient;
    bytes messageBody;
  }

  uint32 destinationDomain = 0x706f6c79; // polygon

  mapping(uint => PendingMessage) pendingMessages;
  uint totalMessages = 0;
  uint messageProcessed = 0;

  function addPendingMessage(
    bytes32 _sender,
    bytes32 _recipient,
    bytes memory _messageBody
  ) external {


    pendingMessages[totalMessages] = PendingMessage(
      _sender,
      _recipient,
      _messageBody
    );
    totalMessages += 1;
  }

  function processNextPendingMessage() public {
    PendingMessage memory pendingMessage = pendingMessages[messageProcessed];

    address recipient = bytes32ToAddress(pendingMessage.recipient);
    
    IMessageRecipient(recipient).handle(
      destinationDomain,
      pendingMessage.sender,
      pendingMessage.messageBody
    );
    messageProcessed += 1;
  }

  function bytes32ToAddress(bytes32 _buf) internal pure returns (address) {
    return address(uint160(uint256(_buf)));
  }
}
