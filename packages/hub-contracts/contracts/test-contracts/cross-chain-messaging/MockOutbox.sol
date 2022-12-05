// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

import { MockInbox } from "./MockInbox.sol";

contract MockOutbox {

  MockInbox inbox;

  constructor(address _inbox) {
    inbox = MockInbox(_inbox);
  }

  function dispatch(
    uint32 _destinationDomain,
    bytes32 _recipientAddress,
    bytes calldata _messageBody
  ) external returns(uint256) {
    inbox.addPendingMessage(
      addressToBytes32(msg.sender),
      _recipientAddress,
      _messageBody
    );
    return uint256(_destinationDomain);
  }

  function addressToBytes32(address _addr) public pure returns (bytes32) {
    return bytes32(uint256(uint160(_addr)));
  }
}
