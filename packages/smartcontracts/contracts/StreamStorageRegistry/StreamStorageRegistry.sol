// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "../metatx/ERC2771Context.sol";
import "../StreamRegistry/StreamRegistry.sol";
import "../NodeRegistry/NodeRegistry.sol";

/**
 * StreamStorageRegistry associates streams to storage nodes in many-to-many relationship
 */
contract StreamStorageRegistry is ERC2771Context {
    StreamRegistry public streamRegistry;
    NodeRegistry public nodeRegistry;

    struct Pair {
        uint dateCreated;
    }
    mapping(string => mapping(address => Pair)) public pairs;

    event Added(string indexed streamId, address indexed nodeAddress);
    event Removed(string indexed streamId, address indexed nodeAddress);

    constructor(address streamRegistryAddress, address nodeRegistryAddress, address trustedForwarderAddress) ERC2771Context(trustedForwarderAddress) {
        streamRegistry = StreamRegistry(streamRegistryAddress);
        nodeRegistry = NodeRegistry(nodeRegistryAddress);
    }

    function _addPair(string calldata streamId, address nodeAddress) private {
        if (pairs[streamId][nodeAddress].dateCreated == 0) { // don't overwrite existing creation date
            pairs[streamId][nodeAddress].dateCreated = block.timestamp; // solhint-disable-line not-rely-on-time
        }
        emit Added(streamId, nodeAddress);
    }
    function _removePair(string calldata streamId, address nodeAddress) private {
        delete pairs[streamId][nodeAddress];
        emit Removed(streamId, nodeAddress);
    }

    function isStorageNodeOf(string calldata streamId, address nodeAddress) public view returns (bool) {
        return pairs[streamId][nodeAddress].dateCreated != 0;
    }

    modifier onlyEditor(string calldata streamId) {
        // TODO: streamRegistry could offer: .exists(streamId) returns (bool)
        // TODO can stream exist without metadata?
        require(bytes(streamRegistry.streamIdToMetadata(streamId)).length != 0, "error_streamDoesNotExist");
        require(streamRegistry.hasPermission(streamId, _msgSender(), StreamRegistry.PermissionType.Edit), "error_noEditPermission");
        _;
    }

    function addStorageNode(string calldata streamId, address nodeAddress) external onlyEditor(streamId) {
        NodeRegistry.Node memory node = nodeRegistry.getNode(nodeAddress);
        require(node.lastSeen != 0, "error_storageNodeNotRegistered");
        _addPair(streamId, nodeAddress);
    }

    function removeStorageNode(string calldata streamId, address nodeAddress) external onlyEditor(streamId) {
        _removePair(streamId, nodeAddress);
    }

    function addAndRemoveStorageNodes(string calldata streamId, address[] calldata addNodes, address[] calldata removeNodes) external onlyEditor(streamId) {
        for (uint i = 0; i < addNodes.length; i++) {
            address nodeAddress = addNodes[i];
            NodeRegistry.Node memory node = nodeRegistry.getNode(nodeAddress);
            require(node.lastSeen != 0, "error_storageNodeNotRegistered");
            _addPair(streamId, nodeAddress);
        }
        for (uint i = 0; i < removeNodes.length; i++) {
            _removePair(streamId, removeNodes[i]);
        }
    }

    /**
     * Method for cleaning up deleted streams from this registry. Anyone can call it.
     * @dev Reverts if any of the streamIds exists in the StreamRegistry (there must be a need for cleanup)
     * @dev Iterates the "cartesian product" of streamIds X storageNodes,
     * @dev   so some care must be taken to give either small number of streamIds or storageNodes,
     * @dev   not a large number of both (of course gas fees would make the "user error" more clear)
     */
    function cleanupStreams(string[] calldata streamIds, address[] calldata storageNodes) external {
        for (uint i = 0; i < streamIds.length; i++) {
            string calldata streamId = streamIds[i];
            // TODO: streamRegistry could offer: .exists(streamId) returns (bool)
            // TODO can stream exist without metadata?
            require(bytes(streamRegistry.streamIdToMetadata(streamId)).length == 0, "error_streamExists");
            for (uint j = 0; j < storageNodes.length; j++) {
                _removePair(streamId, storageNodes[j]);
            }
        }
    }

    /**
     * Method for cleaning up deleted storage nodes from this registry. Anyone can call it.
     * @dev Reverts if any of the storageNodes exists in the NodeRegistry (there must be a need for cleanup)
     * @dev Iterates the "cartesian product" of streamIds X storageNodes,
     * @dev   so some care must be taken to give either small number of streamIds or storageNodes,
     * @dev   not a large number of both (of course gas fees would make the "user error" more clear)
     */
    function cleanupStorageNodes(address[] calldata storageNodes, string[] calldata streamIds) external {
        for (uint i = 0; i < storageNodes.length; i++) {
            address nodeAddress = storageNodes[i];
            NodeRegistry.Node memory node = nodeRegistry.getNode(nodeAddress);
            require(node.lastSeen == 0, "error_storageNodeExists");
            for (uint j = 0; j < streamIds.length; j++) {
                _removePair(streamIds[j], nodeAddress);
            }
        }
    }

}