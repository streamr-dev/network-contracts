pragma solidity ^0.5.16;
import "./TrackerRegistry.sol";
import "./NodeRegistry.sol";

contract SimpleTrackerRegistry is TrackerRegistry, NodeRegistry{

    constructor(address owner, bool permissionless_) NodeRegistry(owner, permissionless_) public {}

    function getTrackers(string memory streamId, uint partition) public view returns (string memory) {
        bytes32 hash = keccak256(abi.encode(streamId, partition));
        uint nodeNum = uint256(hash) % nodeCount;
        address nodeAddress = getNodeByNumber(nodeNum);
        (string memory url,,,) = getNode(nodeAddress);
        return url;
    }
}
