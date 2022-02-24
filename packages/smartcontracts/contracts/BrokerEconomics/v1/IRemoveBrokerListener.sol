// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IRemoveBrokerListener {
    function onBrokerRemoved(string calldata streamId, address broker) external;
}
