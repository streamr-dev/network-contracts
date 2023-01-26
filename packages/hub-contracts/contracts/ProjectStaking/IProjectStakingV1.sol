// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IProjectStakingV1 {
    // project staking events
    event Stake(bytes32 indexed projectId, address indexed user, uint256 amount);
    event Unstake(bytes32 indexed projectId, address indexed user, uint256 amount);

    // project staking functions

    // view functions
    function getProjectStake(bytes32 projectId) external view returns (uint256 projectStake);
    function getUserStake(address userAddress) external view returns (uint256 userStake);
    function getTotalStake() external view returns (uint256 totalStake);

    // state changing functions
    function stake(bytes32 projectId, uint256 amount) external;
    function unstake(bytes32 projectId, uint256 amount) external;
    function onTokenTransfer(address sender, uint256 amount, bytes calldata data) external;
}
