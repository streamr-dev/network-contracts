pragma solidity >=0.4.21 <0.6.0;

interface TrackerRegistry {
    //output is tab-delimited. string[] return type isn't supported
    function getTrackers(string calldata streamId, uint partition) external view returns (string memory);
}