// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// Operator contract announces to the registry when it's eligible to vote, or not eligible anymore.
interface IVoterRegistry {
    event VoterUpdate(address indexed voterAddress, bool indexed isVoter);

    /** Will check if the given contract is eligible or not, update voter list if needed */
    function voterUpdate(address operatorContractAddress) external returns (bool isEligible);

    function voterCount() external view returns (uint);
    function voters(uint index) external view returns (address);
}
