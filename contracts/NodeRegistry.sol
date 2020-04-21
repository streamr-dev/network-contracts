pragma solidity ^0.5.16;

import "./Ownable.sol";

/**
 * @title Ownable
 * @dev The Ownable contract has an owner address, and provides basic authorization control
 * functions, this simplifies the implementation of "user permissions".
 */
contract NodeRegistry is Ownable {
    event NodeUpdated(address indexed nodeAddress, string url, uint lastSeen);
    event NodeRemoved(address indexed nodeAddress);
    event NodeWhitelistApproved(address indexed nodeAddress);
    event NodeWhitelistRejected(address indexed nodeAddress);
    event PermissionlessChanged(bool value);
    enum WhitelistState{
        None,
        Approved,
        Rejected
    }
    struct Node {
        address nodeAddress; // Ethereum address of the node (unique id)
        string url; // Connection url, for example wss://node-domain-name:port
        uint lastSeen; // what's the best way to store timestamps in smart contracts?
        address next; //linked list
        address prev; //linked list
    }

    modifier whitelistOK() {
        require(permissionless || whitelist[msg.sender] == WhitelistState.Approved, "notApproved");
        _;
    }

    uint64 public nodeCount;
    address public tailNode;
    address public headNode;
    bool permissionless;
    mapping(address => Node) nodes;
    mapping(address => WhitelistState) whitelist;

    constructor(address owner, bool permissionless_) Ownable(owner) public {
        permissionless = permissionless_;
    }

    function getNode(address nodeAddress) public view returns (string memory url, uint lastSeen, address nextNode, address prevNode) {
        Node storage n = nodes[nodeAddress];
        return(n.url, n.lastSeen, n.next, n.prev);
    }
    function createOrUpdateNode(address node, string memory url_) public onlyOwner {
        _createOrUpdateNode(node, url_);
    }

    function createOrUpdateNodeSelf(string memory url_) public whitelistOK {
        _createOrUpdateNode(msg.sender, url_);
    }

    function _createOrUpdateNode(address node, string memory url_) internal {
        Node storage n = nodes[node];
        if(n.lastSeen == 0){
            nodes[node] = Node({nodeAddress: node, url: url_, lastSeen: block.timestamp, prev: tailNode, next: address(0)});
            nodeCount++;
            if(tailNode != address(0)){
                Node storage prevNode = nodes[tailNode];
                prevNode.next = node;
            }
            if(headNode == address(0))
                headNode = node;
            tailNode = node;
        }
        else{
            n.url = url_;
            n.lastSeen = block.timestamp;
        }
        emit NodeUpdated(n.nodeAddress, n.url, n.lastSeen);
    }

    function removeNode(address node) public onlyOwner {
        _removeNode(node);
    }
    function removeNodeSelf() public {
        _removeNode(msg.sender);
    }
    function _removeNode(address node) internal {
        Node storage n = nodes[node];
        require(n.lastSeen != 0, "notFound");
        if(n.prev != address(0)){
            Node storage prevNode = nodes[n.prev];
            prevNode.next = n.next;
        }
        if(n.next != address(0)){
            Node storage nextNode = nodes[n.next];
            nextNode.prev = n.prev;
        }
        nodeCount--;
        if(node == tailNode) {
            Node storage tn = nodes[tailNode];
            tailNode = tn.next;
        }
        if(node == headNode) {
            Node storage hn = nodes[headNode];
            tailNode = hn.prev;
        }

        delete nodes[node];
        emit NodeRemoved(node);
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

    function setPermissionless(bool value) public onlyOwner {
        permissionless = value;
        emit PermissionlessChanged(value);
    }
    /*
        this function is O(N) because we need linked list functionality
    */
    function getNodeByNumber(uint i) public view returns (address) {
        require(i < nodeCount, "getNthNode: n must be less than nodeCount");
        address cur = headNode;
        for(uint nodeNum = 0; nodeNum < i; nodeNum++){
            Node storage n = nodes[cur];
            cur = n.next;
        }
        return cur;
    }

    function getNodes() public view returns (address[] memory) {
        address[] memory nodesArray = new address[](nodeCount);
        address cur = headNode;
        for(uint nodeNum = 0; nodeNum < nodeCount; nodeNum++){
            Node storage n = nodes[cur];
            nodesArray[nodeNum] = cur;
            cur = n.next;
        }
        return nodesArray;
    }
}