// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// Operator contract announces to the registry when it's eligible to vote, or not eligible anymore.
interface IVoterRegistry {
    event VoterUpdate(address voterAddress, bool isVoter);

    function registerAsVoter() external;
    function registerAsNonVoter() external;

    function voterCount() external view returns (uint);
    function voters(uint index) external view returns (address);
}