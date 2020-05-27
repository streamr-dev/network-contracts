pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./Ownable.sol";

/**
 * @title Ownable
 * @dev The Ownable contract has an owner address, and provides basic authorization control
 * functions, this simplifies the implementation of "user permissions".
 */
contract NodeRegistry is Ownable {
    event NodeUpdated(address indexed nodeAddress, string indexed url, uint indexed isNew, uint lastSeen);
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
        string url; // Connection url, for example wss://node-domain-name:port
        uint lastSeen; // what's the best way to store timestamps in smart contracts?
    }
    struct NodeLinkedListItem {
        Node node;
        address next; //linked list
        address prev; //linked list
    }

    modifier whitelistOK() {
        require(!requiresWhitelist || whitelist[msg.sender] == WhitelistState.Approved, "notApproved");
        _;
    }

    uint64 public nodeCount;
    address public tailNode;
    address public headNode;
    bool requiresWhitelist;
    mapping(address => NodeLinkedListItem) nodes;
    mapping(address => WhitelistState) whitelist;

    constructor(address owner, bool requiresWhitelist_, address[] memory initialNodes, string[] memory initialUrls ) Ownable(owner) public {
        requiresWhitelist = requiresWhitelist_;
        require(initialNodes.length == initialUrls.length, "bad_tracker_data");
        for (uint i = 0; i < initialNodes.length; i++) {
            createOrUpdateNode(initialNodes[i], initialUrls[i]);
        }
    }

    function getNode(address nodeAddress) public view returns (Node memory) {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        return(n.node);
    }
 
    function createOrUpdateNode(address node, string memory url_) public onlyOwner {
        _createOrUpdateNode(node, url_);
    }

    function createOrUpdateNodeSelf(string memory url_) public whitelistOK {
        _createOrUpdateNode(msg.sender, url_);
    }

    function _createOrUpdateNode(address nodeAddress, string memory url_) internal {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        uint isNew = 0;
        if(n.node.lastSeen == 0){
            isNew = 1;
            nodes[nodeAddress] = NodeLinkedListItem({node: Node({nodeAddress: nodeAddress, url: url_, lastSeen: block.timestamp}), prev: tailNode, next: address(0)});
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
            n.node.url = url_;
            n.node.lastSeen = block.timestamp;
        }
        emit NodeUpdated(nodeAddress, n.node.url, isNew, n.node.lastSeen);
    }

    function removeNode(address nodeAddress) public onlyOwner {
        _removeNode(nodeAddress);
    }
    function removeNodeSelf() public {
        _removeNode(msg.sender);
    }
    function _removeNode(address nodeAddress) internal {
        NodeLinkedListItem storage n = nodes[nodeAddress];
        require(n.node.lastSeen != 0, "notFound");
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
    
    function getNodeByNumber(uint i) public view returns (Node memory) {
        require(i < nodeCount, "getNthNode: n must be less than nodeCount");
        address currentNodeAddress = headNode;
        NodeLinkedListItem storage n = nodes[currentNodeAddress];
        for(uint nodeNum = 1; nodeNum <= i; nodeNum++){
            currentNodeAddress = n.next;
            n = nodes[currentNodeAddress];
        }
        return n.node;
    }

    function getNodes() public view returns (Node[] memory) {
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