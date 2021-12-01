// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";

// import "../metatx/ERC2771Context.sol";
import "../StreamRegistry/StreamRegistry.sol";
import "../NodeRegistry/NodeRegistry.sol";

import "./IAddBrokerListener.sol";
import "./IRemoveBrokerListener.sol";

/**
 * StreamBrokerRegistry associates streams to broker nodes in many-to-many relationship
 */
contract StreamBrokerRegistry is Ownable { //, ERC2771Context {

    event BrokerAdded(string streamId, address indexed broker);
    event BrokerRemoved(string streamId, address indexed broker);

    event AddBrokerListenerAdded(IAddBrokerListener newListener);
    event AddBrokerListenerRemoved(IAddBrokerListener listener);
    event RemoveBrokerListenerAdded(IRemoveBrokerListener newListener);
    event RemoveBrokerListenerRemoved(IRemoveBrokerListener listener);

    StreamRegistry public streamRegistry;
    NodeRegistry public nodeRegistry;

    // Streams that have registered brokers (or had in the past)
    struct Stream {
        string id;
        address[] brokers;
    }
    mapping(string => Stream) public streams;

    address[] public addBrokerListeners;
    address[] public removeBrokerListeners;

    uint constant private NOT_FOUND = type(uint).max;

    constructor(address streamRegistryAddress, address nodeRegistryAddress) { //, address trustedForwarderAddress) ERC2771Context(trustedForwarderAddress) {
        streamRegistry = StreamRegistry(streamRegistryAddress);
        nodeRegistry = NodeRegistry(nodeRegistryAddress);
    }

    function streamExists(string calldata streamId) public view returns (bool) {
        return bytes(streams[streamId].id).length > 0 || streamRegistry.exists(streamId);
    }

    modifier onlyEditorOrTrusted(string calldata streamId) {
        require(streamRegistry.exists(streamId), "error_streamDoesNotExist");
        bool isTrusted = streamRegistry.hasRole(keccak256("TRUSTED_ROLE"), _msgSender());
        if (!isTrusted) {
            require(streamRegistry.hasPermission(streamId, _msgSender(), StreamRegistry.PermissionType.Edit), "error_noEditPermission");
        }
        _;
    }

   /**
    * Add broker to a stream, and also "cache" the stream into this contract from the StreamRegistry.
    * TODO: should later deletion in StreamRegistry actually show up here? Could be problematic if agreements hold tokens belonging to deleted streams. Add listener mechanism to StreamRegistry?
    */
    function _addBroker(string calldata streamId, address broker) private {
        Stream storage stream = streams[streamId];
        if (bytes(stream.id).length == 0) {
            require(streamRegistry.exists(streamId), "error_streamDoesNotExist");
            streams[streamId].id = streamId;
            stream = streams[streamId];
        }
        stream.brokers.push(broker);

        // listeners get a chance to reject the broker by reverting
        for (uint i = 0; i < addBrokerListeners.length; i++) {
            address listener = addBrokerListeners[i];
            IAddBrokerListener(listener).onBrokerAdded(streamId, broker); // may revert
        }

        emit BrokerAdded(streamId, broker);
    }

    // TODO: can broker lists be long? This could be log(N) with a sorted list or a heap
    /** @return index in the brokers array, or type(uint).max if not found */
    function _findBrokerIndex(string calldata streamId, address broker) private view returns (uint index) {
        Stream storage stream = streams[streamId];
        if (bytes(stream.id).length == 0) { return NOT_FOUND; }
        index = 0;
        while (index < stream.brokers.length && stream.brokers[index] != broker) { index += 1; }
        return index < stream.brokers.length ? index : NOT_FOUND;
    }

    function isBrokerOf(string calldata streamId, address broker) public view returns (bool) {
        uint index = _findBrokerIndex(streamId, broker);
        return index != NOT_FOUND;
    }

    function brokerCount(string calldata streamId) public view returns (uint) {
        Stream storage stream = streams[streamId];
        return stream.brokers.length;
    }

    function _removeBroker(string calldata streamId, address broker) private {
        uint index = _findBrokerIndex(streamId, broker);
        require(index != NOT_FOUND, "error_brokerNotFound");
        Stream storage stream = streams[streamId];
        removeFromAddressArrayUsingIndex(stream.brokers, index);

        // listeners do NOT get a chance to prevent parting by reverting
        for (uint i = 0; i < removeBrokerListeners.length; i++) {
            address listener = removeBrokerListeners[i];
            try IRemoveBrokerListener(listener).onBrokerRemoved(streamId, broker) { } catch { }
        }

        emit BrokerRemoved(streamId, broker);
    }

    function addBroker(string calldata streamId, address broker) external onlyEditorOrTrusted(streamId) {
        NodeRegistry.Node memory node = nodeRegistry.getNode(broker);
        require(node.lastSeen != 0, "error_brokerNodeNotRegistered");
        _addBroker(streamId, broker);
    }

    function removeBroker(string calldata streamId, address broker) external onlyEditorOrTrusted(streamId) {
        _removeBroker(streamId, broker);
    }

    // TODO: if len(addNodes+removeNodes) * len(brokers) becomes large, use heap for brokers; or require that both arrays are sorted
    function addAndRemoveBrokers(string calldata streamId, address[] calldata addNodes, address[] calldata removeNodes) external onlyEditorOrTrusted(streamId) {
        for (uint i = 0; i < addNodes.length; i++) {
            address broker = addNodes[i];
            NodeRegistry.Node memory node = nodeRegistry.getNode(broker);
            require(node.lastSeen != 0, "error_brokerNodeNotRegistered");
            _addBroker(streamId, broker);
        }
        for (uint i = 0; i < removeNodes.length; i++) {
            _removeBroker(streamId, removeNodes[i]);
        }
    }

    function addBrokerListenerAdd(IAddBrokerListener newListener) public onlyOwner {
        // TODO: check EIP-165?
        addBrokerListeners.push(address(newListener));
        emit AddBrokerListenerAdded(newListener);
    }

    function removeBrokerListenerAdd(IRemoveBrokerListener newListener) public onlyOwner {
        // TODO: check EIP-165?
        removeBrokerListeners.push(address(newListener));
        emit RemoveBrokerListenerAdded(newListener);
    }

    function addBrokerListenerRemove(IAddBrokerListener listener) public onlyOwner {
        require(removeFromAddressArray(addBrokerListeners, address(listener)), "error_joinListenerNotFound");
        emit AddBrokerListenerRemoved(listener);
    }

    function removeBrokerListenerRemove(IRemoveBrokerListener listener) public onlyOwner {
        require(removeFromAddressArray(removeBrokerListeners, address(listener)), "error_partListenerNotFound");
        emit RemoveBrokerListenerRemoved(listener);
    }

    /**
     * Remove the listener from array by copying the last element into its place so that the arrays stay compact
     */
    function removeFromAddressArray(address[] storage array, address element) internal returns (bool success) {
        uint i = 0;
        while (i < array.length && array[i] != element) { i += 1; }
        return removeFromAddressArrayUsingIndex(array, i);
    }

    /**
     * Remove the listener from array by copying the last element into its place so that the arrays stay compact
     */
    function removeFromAddressArrayUsingIndex(address[] storage array, uint index) internal returns (bool success) {
        if (index < 0 || index >= array.length) return false;
        if (index < array.length - 1) {
            array[index] = array[array.length - 1];
        }
        array.pop();
        return true;
    }

}