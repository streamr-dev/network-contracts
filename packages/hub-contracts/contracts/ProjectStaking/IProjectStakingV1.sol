// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IProjectStakingV1 {
    // project staking events

    event Stake(bytes32 indexed projectId, address indexed user, uint256 amount);
    event Unstake(bytes32 indexed projectId, address indexed user, uint256 amount);

    // events after upgrade (0xfb5e20c0daf89b2fd026755d374d59b4e802ccdca6f6e3721691c0483ea9fdcd)
    event Stake(bytes32 indexed projectId, address indexed user, uint256 amount, uint256 projectStake);
    event Unstake(bytes32 indexed projectId, address indexed user, uint256 amount, uint256 projectStake);

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
