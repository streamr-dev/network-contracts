pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

interface TrackerRegistry {
    function getTrackers(string calldata streamId, uint partition) external view returns (string[] memory);
}