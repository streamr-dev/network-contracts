// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

interface IAddBrokerListener {
    function onBrokerAdded(string calldata streamId, address broker) external;
}
