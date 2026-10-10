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

    /**
     * Reduce stake in some Sponsorships, then stake into others; see Operator.rebalanceStake
     * @dev This was put into NodeModule only because StakeModule is at the contract size limit (every module includes Operator's bytecode).
     * @dev The staking logic itself stays in StakeModule, called via moduleCall (nested delegatecall, still in Operator's storage context).
     */
    function _rebalanceStake(
        Sponsorship[] calldata reduceStakeFromSponsorships,
        uint[] calldata reducedTargetStakesWei,
        Sponsorship[] calldata stakeOnSponsorships,
        uint[] calldata stakeAmountsWei
    ) external {
        if (reduceStakeFromSponsorships.length != reducedTargetStakesWei.length || stakeOnSponsorships.length != stakeAmountsWei.length) {
            revert ArrayLengthMismatch();
        }

        // fail fast, before spending gas on the reductions: staking into a full Sponsorship would only revert at the very end
        _checkCanJoin(stakeOnSponsorships);

        address stakeModuleAddress = address(stakeModule);
        for (uint i; i < reduceStakeFromSponsorships.length; i++) {
            moduleCall(stakeModuleAddress, abi.encodeWithSelector(
                IStakeModule._reduceStakeTo.selector, reduceStakeFromSponsorships[i], reducedTargetStakesWei[i]
            ));
        }

        // pay out the undelegation queue from the freed DATA, same as reduceStakeTo does (_stake reverts if the queue isn't empty afterwards)
        if (!queueIsEmpty()) {
            payOutQueue(0);
        }

        for (uint i; i < stakeOnSponsorships.length; i++) {
            moduleCall(stakeModuleAddress, abi.encodeWithSelector(
                IStakeModule._stake.selector, stakeOnSponsorships[i], stakeAmountsWei[i]
            ));
        }
    }

    /**
     * Revert if any of the given Sponsorships is already full (max operator count reached).
     * Sponsorships we're already staked in are skipped: increasing an existing stake doesn't count against the max operator count.
     * Whether the target is a Streamr Sponsorship at all is checked later, by StakeModule._stake.
     */
    function _checkCanJoin(Sponsorship[] calldata targets) internal view {
        for (uint i; i < targets.length; i++) {
            Sponsorship sponsorship = targets[i];
            if (indexOfSponsorships[sponsorship] > 0) { continue; }
            // Sponsorships deployed from an older template don't have isFull(): skip the check and just try staking
            try sponsorship.isFull() returns (bool full) {
                if (full) {
                    revert SponsorshipFull(sponsorship);
                }
            } catch {} // solhint-disable-line no-empty-blocks
        }
    }
}
