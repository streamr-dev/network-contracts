/**
 * Deployed on polygon on 2022-09-09
 */

// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "../StreamRegistry/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/Initializable.sol";
import "../StreamRegistry/StreamRegistryV4.sol";
import "../NodeRegistry/NodeRegistry.sol";

/**
 * StreamStorageRegistry associates streams to storage nodes in many-to-many relationship
 */
contract StreamStorageRegistryV2 is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable {
    StreamRegistryV4 public streamRegistry;
    NodeRegistry public nodeRegistry;

    struct StreamNodePair {
        uint dateCreated;
    }
    mapping(string => mapping(address => StreamNodePair)) public pairs;

    event Added(string streamId, address indexed nodeAddress);
    event Removed(string streamId, address indexed nodeAddress);

    modifier onlyEditorOrTrusted(string calldata streamId) {
        require(streamRegistry.exists(streamId), "error_streamDoesNotExist");
        bool senderIsTrusted = streamRegistry.hasRole(streamRegistry.getTrustedRole(), _msgSender());
        if (!senderIsTrusted) {
            require(streamRegistry.hasPermission(streamId, _msgSender(), StreamRegistryV4.PermissionType.Edit), "error_noEditPermission");
        }
        _;
    }

    modifier isTrusted() {
        require(streamRegistry.hasRole(streamRegistry.getTrustedRole(), _msgSender()), "error_notTrustedRole");
        _;
    }

    // Constructor can't be used with upgradeable contracts, so use initialize instead
    //    this will not be called upon each upgrade, only once during first deployment
    function initialize(address streamRegistryAddress, address nodeRegistryAddress, address trustedForwarderAddress) public initializer {
        streamRegistry = StreamRegistryV4(streamRegistryAddress);
        nodeRegistry = NodeRegistry(nodeRegistryAddress);
        ERC2771ContextUpgradeable.__ERC2771Context_init(trustedForwarderAddress);
    }

    function _authorizeUpgrade(address) internal override isTrusted() {}

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
        if (!streamRegistry.exists(streamId)) { return false; }
        NodeRegistry.Node memory node = nodeRegistry.getNode(nodeAddress);
        if (node.lastSeen == 0) { return false; }
        return pairs[streamId][nodeAddress].dateCreated != 0;
    }

    function addStorageNode(string calldata streamId, address nodeAddress) external onlyEditorOrTrusted(streamId) {
        NodeRegistry.Node memory node = nodeRegistry.getNode(nodeAddress);
        require(node.lastSeen != 0, "error_storageNodeNotRegistered");
        _addPair(streamId, nodeAddress);
    }

    function removeStorageNode(string calldata streamId, address nodeAddress) external onlyEditorOrTrusted(streamId) {
        _removePair(streamId, nodeAddress);
    }

    function addAndRemoveStorageNodes(string calldata streamId, address[] calldata addNodes, address[] calldata removeNodes) external onlyEditorOrTrusted(streamId) {
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

    function setTrustedForwarder(address forwarder) public isTrusted() {
        _setTrustedForwarder(forwarder);
    }
}