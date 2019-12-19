pragma solidity >=0.4.21 <0.6.0;

import "./Ownable.sol";

/**
 * @title Ownable
 * @dev The Ownable contract has an owner address, and provides basic authorization control
 * functions, this simplifies the implementation of "user permissions".
 */
contract NodeRegistry is Ownable {
    event NodeUpdated(address indexed nodeAddress, string url, uint lastSeen);
    event NodeRemoved(address indexed nodeAddress);
    event NodeWhitelisted(address indexed nodeAddress);
    event PermissionlessChanged(bool value);
    enum WhitelistState{
        None,
        Pending,
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

    function createOrUpdateNode(string memory url_) public whitelistOK {
        Node storage n = nodes[msg.sender];
        if(n.lastSeen == 0){
            nodes[msg.sender] = Node({nodeAddress: msg.sender, url: url_, lastSeen: block.timestamp, prev: tailNode, next: address(0)});
            nodeCount++;
            if(tailNode != address(0)){
                Node storage prevNode = nodes[tailNode];
                prevNode.next = msg.sender;
            }
            if(headNode == address(0))
                headNode = msg.sender;
            tailNode = msg.sender;
        }
        else{
            n.url = url_;
            n.lastSeen = block.timestamp;
        }
        emit NodeUpdated(n.nodeAddress, n.url, n.lastSeen);
    }

    function removeNode() public {
        Node storage n = nodes[msg.sender];
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
        if(msg.sender == tailNode) {
            Node storage tn = nodes[tailNode];
            tailNode = tn.next;
        }
        if(msg.sender == headNode) {
            Node storage hn = nodes[headNode];
            tailNode = hn.prev;
        }

        delete nodes[msg.sender];
        emit NodeRemoved(msg.sender);
    }

    function whitelistNode(address nodeAddress) public onlyOwner {
        whitelist[nodeAddress] = WhitelistState.Approved;
        emit NodeWhitelisted(nodeAddress);
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
        for(uint nodeNum = i; nodeNum > 0; nodeNum--){
            Node storage n = nodes[cur];
            cur = n.next;
        }
        return cur;
    }
/*    
    // this doesnt quite work because array size must be int literal or constant
    function getNodes() public returns (Node[] memory){
        Node[] memory nodeList = new Node[nodeCount];
        address memory last = tailNode;
        int64 memory i;
        while(last != address(0)){
            Node storage n = nodes[last];
            nodeList[nodeCount - i - 1] = n;
        }
        return nodeList;
    } 
*/
}