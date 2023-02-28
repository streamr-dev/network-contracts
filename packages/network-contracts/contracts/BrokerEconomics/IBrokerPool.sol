// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "./IBounty.sol";
import "./BrokerPoolPolicies/IPoolJoinPolicy.sol";
import "./BrokerPoolPolicies/IPoolYieldPolicy.sol";
import "./BrokerPoolPolicies/IPoolExitPolicy.sol";

/**
 * BrokerPool receives the delegators' investments and pays out yields
 * It also is an ERC20 token for the pool tokens that each delegator receives and can swap back to DATA when they want to exit the pool
 *
 * The whole token balance of the pool IS SAME AS the "free funds", so there's no need to track the unallocated tokens separately
 */
interface IBrokerPool is IAccessControlUpgradeable {

    function getApproximatePoolValue() external view returns (uint);

    function onSlash() external;
    function queueIsEmpty() external view returns (bool);
    function calculatePoolValueInData() external view returns (uint256 poolValue);
    function getApproximatePoolValuesPerBounty() external view returns (address[] memory bountyAdresses,
        uint[] memory approxValues,
        uint[] memory realValues
    );

    // investor functions
    function invest(uint amountWei) external;
    function getMyBalanceInData() external view returns (uint256 amountDataWei);
    function getMyQueuedPayoutPoolTokens() external view returns (uint256 amountDataWei);
    function queueDataPayout(uint amountPoolTokenWei) external;
    function queueDataPayoutWithoutQueue(uint amountPoolTokenWei) external;

    // broker functions
    function stake(IBounty bounty, uint amountWei) external;
    function unstake(IBounty bounty, uint maxPayoutCount) external;
    function reduceStake(IBounty bounty, uint amountWei) external;
    function withdrawWinningsFromBounty(IBounty bounty) external;

    // everyon can call
    function payOutQueueWithFreeFunds(uint maxIterations) external;
    function payOutQueue() external returns (bool payoutComplete);
    function forceUnstake(IBounty bounty, uint maxIterations) external;
    function updateApproximatePoolvalueOfBounty(IBounty bounty) external;
    function updateApproximatePoolvalueOfBounties(IBounty[] memory bountyAddresses) external;
    // function getPoolValueFromBounty(IBounty bounty) external view returns (uint256 poolValue);

    // admin/setup functions
    function getAdminRole() external view returns(bytes32);
    function getDefaultAdminRole() external view returns(bytes32);
    function setJoinPolicy(IPoolJoinPolicy policy, uint256 initialMargin, uint256 minimumMarginPercent) external;
    function setYieldPolicy(IPoolYieldPolicy policy,
        uint256 initialMargin,
        uint256 maintenanceMarginPercent,
        uint256 minimumMarginPercent,
        uint256 brokerSharePercent,
        uint256 brokerShareMaxDivertPercent) external;
    function setExitPolicy(IPoolExitPolicy policy, uint param) external;
    function initialize(
        address tokenAddress,
        address streamrConstants,
        address brokerAddress,
        string calldata poolName,
        uint initialMinimumDelegationWei
    ) external;
}
