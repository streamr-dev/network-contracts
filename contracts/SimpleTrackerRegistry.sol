pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "./TrackerRegistry.sol";
import "./NodeRegistry.sol";

contract SimpleTrackerRegistry is TrackerRegistry, NodeRegistry{

    constructor(address owner, bool requiresWhitelist_, address[] memory initialNodes, string[] memory initialUrls)
        NodeRegistry(owner, requiresWhitelist_, initialNodes, initialUrls) public {}
    function getTrackers(string memory streamId, uint partition) public override view returns (string[] memory) {
        bytes32 hash = keccak256(abi.encode(streamId, partition));
        uint nodeNum = uint256(hash) % nodeCount;
        string[] memory trackers = new string[](1);
        trackers[0] = getNodeByNumber(nodeNum).url;
        return trackers;
    }
}
