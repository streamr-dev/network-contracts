// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "./BountyPolicies/IAllocationPolicy.sol";
import "./BountyPolicies/ILeavePolicy.sol";
import "./BountyPolicies/IKickPolicy.sol";
import "./BountyPolicies/IJoinPolicy.sol";
import "./StreamrConstants.sol";

interface IBounty is IAccessControlUpgradeable {

    // should be deleted or always use msg.sender?
    function getStake(address broker) external view returns (uint);
    function getMyStake() external view returns (uint);
    function getAllocation(address broker) external view returns(uint256 allocation);
    function getLeavePenalty(address broker) external view returns(uint256 leavePenalty);

    function isAdmin(address a) external view returns(bool);
    function getAdminRole() external view returns(bytes32);
    function getDefaultAdminRole() external view returns(bytes32);
    function getUnallocatedWei() external view returns(uint);
    function getBrokerCount() external view returns(uint);
    function isFunded() external view returns (bool);
    function solventUntil() external view returns(uint256 horizon);

    function stake(address broker, uint amountTokenWei) external;
    function leave() external;
    function reduceStake(uint cashoutWei) external;
    function withdraw() external;
    
    function flag(address target, address myBrokerPool) external;
    function cancelFlag(address target, address myBrokerPool) external;
    function voteOnFlag(address target, bytes32 voteData) external;

    function setAllocationPolicy(IAllocationPolicy newAllocationPolicy, uint param) external;
    function setLeavePolicy(ILeavePolicy newLeavePolicy, uint param) external;
    function setKickPolicy(IKickPolicy newKickPolicy, uint param) external;
    function addJoinPolicy(IJoinPolicy newJoinPolicy, uint param) external;
    function initialize(
        StreamrConstants streamrConstants,
        address newOwner,
        address tokenAddress,
        uint32 initialMinHorizonSeconds,
        uint32 initialMinBrokerCount,
        IAllocationPolicy initialAllocationPolicy,
        uint allocationPolicyParam
    ) external;
}