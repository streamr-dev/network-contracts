// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "./Ownable.sol";

/**
 * @title Ownable
 * @dev The Ownable contract has an owner address, and provides basic authorization control
 * functions, this simplifies the implementation of "user permissions".
 */
contract NodeRegistry is Ownable {
    event NodeUpdated(address indexed nodeAddress, string indexed metadata, uint indexed isNew, uint lastSeen);
    event NodeRemoved(address indexed nodeAddress);
    event NodeWhitelistApproved(address indexed nodeAddress);
    event NodeWhitelistRejected(address indexed nodeAddress);
    event RequiresWhitelistChanged(bool indexed value);

    enum WhitelistState{
        None,
        Approved,
        Rejected
    }

    struct Node{
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

    constructor(address owner, bool requiresWhitelist_, address[] memory initialNodes, string[] memory initialMetadata ) public Ownable(owner) {
        requiresWhitelist = requiresWhitelist_;
        require(initialNodes.length == initialMetadata.length, "error_badTrackerData");
        for (uint i = 0; i < initialNodes.length; i++) {
            createOrUpdateNode(initialNodes[i], initialMetadata[i]);
        }
    }

    function getNode(address nodeAddress) public view returns (Node memory) {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        return(n.node);
    }

    function createOrUpdateNode(address node, string memory metadata_) public onlyOwner {
        _createOrUpdateNode(node, metadata_);
    }

    function createOrUpdateNodeSelf(string memory metadata_) public whitelistOK {
        _createOrUpdateNode(msg.sender, metadata_);
    }

    function _createOrUpdateNode(address nodeAddress, string memory metadata_) internal {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        uint isNew = 0;
        if(n.node.lastSeen == 0){
            isNew = 1;
            nodes[nodeAddress] = NodeLinkedListItem({
                node: Node({nodeAddress: nodeAddress, metadata: metadata_, lastSeen: block.timestamp}), // solhint-disable-line not-rely-on-time
                prev: tailNode, next: address(0)
            });
            nodeCount++;
            if(tailNode != address(0)){
                NodeLinkedListItem storage prevNode = nodes[tailNode];
                prevNode.next = nodeAddress;
            }
            if(headNode == address(0))
                headNode = nodeAddress;
            tailNode = nodeAddress;
        }
        else{
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