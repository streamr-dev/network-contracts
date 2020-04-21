pragma solidity ^0.5.16;

interface TrackerRegistry {
    //output is tab-delimited. string[] return type isn't supported
    function getTrackers(string calldata streamId, uint partition) external view returns (string memory);
}