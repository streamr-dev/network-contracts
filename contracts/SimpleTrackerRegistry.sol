pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;
import "./TrackerRegistry.sol";
import "./NodeRegistry.sol";

contract SimpleTrackerRegistry is TrackerRegistry, NodeRegistry{

    constructor(address owner, bool requiresWhitelist_) NodeRegistry(owner, requiresWhitelist_) public {}

    function getTrackers(string memory streamId, uint partition) public view returns (string[] memory) {
        bytes32 hash = keccak256(abi.encode(streamId, partition));
        uint nodeNum = uint256(hash) % nodeCount;
        string[] memory trackers = new string[](1);
        trackers[0] = getNodeByNumber(nodeNum).url;
        return trackers;
    }
}
