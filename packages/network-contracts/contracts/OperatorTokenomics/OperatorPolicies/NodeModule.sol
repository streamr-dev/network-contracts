// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./INodeModule.sol";
import "../StreamrConfig.sol";
import "../Operator.sol";

contract NodeModule is INodeModule, Operator {
    mapping (address => bool) private isInNewNodes; // lookup used during the setNodeAddresses

    function createCoordinationStream() external {
        streamRegistry = IStreamRegistryV4(streamrConfig.streamRegistryAddress());
        streamId = string.concat(streamRegistry.addressToString(address(this)), "/operator/coordination");
        streamRegistry.createStream("/operator/coordination", "{\"partitions\":1}");
        streamRegistry.grantPublicPermission(streamId, IStreamRegistryV4.PermissionType.Subscribe);
    }

    function _setNodeAddresses(address[] calldata newNodes) external {
        // add new nodes on top
        for (uint i; i < newNodes.length; i++) {
            address node = newNodes[i];
            if (nodeIndex[node] == 0) {
                _addNode(node);
            }
            isInNewNodes[node] = true;
        }
        // remove from old nodes
        for (uint i; i < nodes.length;) {
            address node = nodes[i];
            if (!isInNewNodes[node]) {
                _removeNode(node);
            } else {
                i++;
            }
        }
        // reset lookup (TODO: replace with transient storage once https://eips.ethereum.org/EIPS/eip-1153 is available)
        for (uint i; i < newNodes.length; i++) {
            address node = newNodes[i];
            delete isInNewNodes[node];
        }
        emit NodesSet(nodes);
    }

    /** First add then remove addresses (if in both lists, ends up removed!) */
    function _updateNodeAddresses(address[] calldata addNodes, address[] calldata removeNodes) external {
        for (uint i; i < addNodes.length; i++) {
            address node = addNodes[i];
            if (nodeIndex[node] == 0) {
                _addNode(node);
            }
        }
        for (uint i; i < removeNodes.length; i++) {
            address node = removeNodes[i];
            if (nodeIndex[node] > 0) {
                _removeNode(node);
            }
        }
        emit NodesSet(nodes);
    }

    function _addNode(address node) internal {
        nodes.push(node);
        nodeIndex[node] = nodes.length; // will be +1

        streamRegistry.grantPermission(streamId, node, IStreamRegistryV4.PermissionType.Publish);
    }

    function _removeNode(address node) internal {
        uint index = nodeIndex[node] - 1;
        address lastNode = nodes[nodes.length - 1];
        nodes[index] = lastNode;
        nodes.pop();
        nodeIndex[lastNode] = index + 1;
        delete nodeIndex[node];

        streamRegistry.revokePermission(streamId, node, IStreamRegistryV4.PermissionType.Publish);
    }
}
