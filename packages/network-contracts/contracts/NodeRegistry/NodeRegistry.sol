// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-4.4.2/proxy/utils/Initializable.sol";

/**
 * @title NodeRegistry
 *
 * Streamr Network nodes register themselves here
 *
 * @dev OwnableUpgradable contract has an owner address, and provides basic authorization control functions.
 * @dev   This simplifies the implementation of "user permissions".
 */
contract NodeRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    // TODO: next version isNew should be boolean
    event NodeUpdated(address indexed nodeAddress, string metadata, uint indexed isNew, uint lastSeen);
    event NodeRemoved(address indexed nodeAddress);
    event NodeWhitelistApproved(address indexed nodeAddress);
    event NodeWhitelistRejected(address indexed nodeAddress);
    event RequiresWhitelistChanged(bool indexed value);

    enum WhitelistState {
        None,
        Approved,
        Rejected
    }

    struct Node {
        address nodeAddress; // Ethereum address of the node (unique id)
        string metadata; // Connection metadata, for example wss://node-domain-name:port
        uint lastSeen; // what's the best way to store timestamps in smart contracts?
    }

    struct NodeLinkedListItem {
        Node node;
        address next; //linked list
        address prev; //linked list
    }

    modifier whitelistOK() {
        require(!requiresWhitelist || whitelist[msg.sender] == WhitelistState.Approved, "error_notApproved");
        _;
    }

    uint64 public nodeCount;
    address public tailNode;
    address public headNode;
    bool public requiresWhitelist;
    mapping(address => NodeLinkedListItem) public nodes;
    mapping(address => WhitelistState) public whitelist;

    // Constructor can't be used with upgradeable contracts, so use initialize instead
    //    this will not be called upon each upgrade, only once during first deployment
    function initialize(address owner, bool requiresWhitelist_, address[] memory initialNodes, string[] memory initialMetadata) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        requiresWhitelist = requiresWhitelist_;
        require(initialNodes.length == initialMetadata.length, "error_badTrackerData");
        for (uint i = 0; i < initialNodes.length; i++) {
            createOrUpdateNode(initialNodes[i], initialMetadata[i]);
        }
        transferOwnership(owner);
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function getNode(address nodeAddress) public view returns (Node memory) {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        return n.node;
    }

    // TODO: add function
    // function exists(address nodeAddress) public view returns (bool) {
    //     NodeLinkedListItem storage n = nodes[nodeAddress];
    //     return n.node.lastSeen != 0;
    // }

    // TODO: rename to adminCreateOrUpdateNode
    function createOrUpdateNode(address node, string memory metadata_) public onlyOwner {
        _createOrUpdateNode(node, metadata_);
    }

    // TODO: rename to createOrUpdateNode
    function createOrUpdateNodeSelf(string memory metadata_) public whitelistOK {
        _createOrUpdateNode(msg.sender, metadata_);
    }

    function _createOrUpdateNode(address nodeAddress, string memory metadata_) internal {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        uint isNew = 0;
        if (n.node.lastSeen == 0) {
            isNew = 1;
            nodes[nodeAddress] = NodeLinkedListItem({
                node: Node({nodeAddress: nodeAddress, metadata: metadata_, lastSeen: block.timestamp}), // solhint-disable-line not-rely-on-time
                prev: tailNode, next: address(0)
            });
            nodeCount++;
            if (tailNode != address(0)) {
                NodeLinkedListItem storage prevNode = nodes[tailNode];
                prevNode.next = nodeAddress;
            }
            if (headNode == address(0)) {
                headNode = nodeAddress;
            }
            tailNode = nodeAddress;
        } else {
            n.node.metadata = metadata_;
            n.node.lastSeen = block.timestamp; // solhint-disable-line not-rely-on-time
        }
        emit NodeUpdated(nodeAddress, n.node.metadata, isNew, n.node.lastSeen);
    }

    function removeNode(address nodeAddress) public onlyOwner {
        _removeNode(nodeAddress);
    }
    function removeNodeSelf() public {
        _removeNode(msg.sender);
    }
    function _removeNode(address nodeAddress) internal {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        require(n.node.lastSeen != 0, "error_notFound");
        if(n.prev != address(0)){
            NodeLinkedListItem storage prevNode = nodes[n.prev];
            prevNode.next = n.next;
        }
        if(n.next != address(0)){
            NodeLinkedListItem storage nextNode = nodes[n.next];
            nextNode.prev = n.prev;
        }
        nodeCount--;
        if(nodeAddress == tailNode) {
            NodeLinkedListItem storage tn = nodes[tailNode];
            tailNode = tn.prev;
        }
        if(nodeAddress == headNode) {
            NodeLinkedListItem storage hn = nodes[headNode];
            headNode = hn.next;
        }

        delete nodes[nodeAddress];
        emit NodeRemoved(nodeAddress);
    }

    function whitelistApproveNode(address nodeAddress) public onlyOwner {
        whitelist[nodeAddress] = WhitelistState.Approved;
        emit NodeWhitelistApproved(nodeAddress);
    }

    function whitelistRejectNode(address nodeAddress) public onlyOwner {
        whitelist[nodeAddress] = WhitelistState.Rejected;
        emit NodeWhitelistRejected(nodeAddress);
    }

    function kickOut(address nodeAddress) public onlyOwner {
        whitelistRejectNode(nodeAddress);
        removeNode(nodeAddress);
    }

    function setRequiresWhitelist(bool value) public onlyOwner {
        requiresWhitelist = value;
        emit RequiresWhitelistChanged(value);
    }
    /*
        this function is O(N) because we need linked list functionality.

        i=0 is first node
    */

    function getNodeByNumber(uint i) external view returns (Node memory) {
        require(i < nodeCount, "error_indexOutOfBounds");
        address currentNodeAddress = headNode;
        NodeLinkedListItem storage n = nodes[currentNodeAddress];
        for(uint nodeNum = 1; nodeNum <= i; nodeNum++){
            currentNodeAddress = n.next;
            n = nodes[currentNodeAddress];
        }
        return n.node;
    }

    function getNodes() external view returns (Node[] memory) {
        Node[] memory nodeArray = new Node[](nodeCount);
        address currentNodeAddress = headNode;
        for(uint nodeNum = 0; nodeNum < nodeCount; nodeNum++){
            NodeLinkedListItem storage n = nodes[currentNodeAddress];
            nodeArray[nodeNum] = n.node;
            currentNodeAddress = n.next;
        }
        return nodeArray;
    }
}
