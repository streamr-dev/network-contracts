// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ProjectRegistry/IProjectRegistry.sol";

/**
 * @title ProjectStakingV1
 * Simple staking and unstaking functionality related to projects.
 * It allows users to deposit tokens to the contract and specify a projectId which they're staking the tokens for.
 * The contract keeps track of who has staked how many tokens against what projects.
 */
contract ProjectStakingV1 {
    
    IProjectRegistry projectRegistry;
    address stakingTokenAddress;

    mapping(address => mapping(bytes32 => uint256)) stakedTokens;
    mapping(bytes32 => uint256) stakedTokensByProject;
    mapping(address => uint256) stakedTokensByUser;
    uint256 totalStakedTokens;

    event Stake(bytes32 indexed projectId, address indexed user, uint256 amount);
    event Unstake(bytes32 indexed projectId, address indexed user, uint256 amount);

    modifier projectExists(bytes32 projectId) {
        require(projectRegistry.exists(projectId), "error_projectNotFound");
        _;
    }

    constructor(address projectRegistryAddress, address tokenAddress) {
        projectRegistry = IProjectRegistry(projectRegistryAddress);
        stakingTokenAddress = tokenAddress;
    }

    /**
     * @notice Stake tokens for a user on a specific project.
     * @param projectId The project to stake tokens for. Must be a valid projectId (e.g. existing in the project registry).
     * @param amount The amount of tokens to stake. Transferred from the caller to this contract and added to the staked balance.
     */
    function stake(bytes32 projectId, uint256 amount) external projectExists(projectId) {
        IERC20(stakingTokenAddress).transferFrom(msg.sender, address(this), amount);
        _stake(projectId, amount, msg.sender);
    }

    /**
     * ERC677 token callback. Stake tokens for a user on a specific project.
     * If the data bytes contains a project id, the stake is added for that project
     * @dev The amount transferred is in stakingToken.
     * @param sender The EOA initiating the transaction through transferAndCall.
     * @param amount The amount to be transferred (in wei).
     * @param data Project id in bytes32.
     */
    function onTokenTransfer(address sender, uint256 amount, bytes calldata data) external {
        require(data.length == 32, "error_badProjectId");
        require(msg.sender == stakingTokenAddress, "error_wrongStakingToken");

        bytes32 projectId;
        assembly { projectId := calldataload(data.offset) } // solhint-disable-line no-inline-assembly

        _stake(projectId, amount, sender);
    }

    /**
     * @notice Unstake tokens for a user on a specific project.
     * @param projectId The project to unstake tokens for. Must be a valid projectId (e.g. existing in the project registry).
     * @param amount The amount of tokens to unstake. Transferred from this contract to the caller and subtracted from the staked balance.
     */
    function unstake(bytes32 projectId, uint256 amount) external projectExists(projectId) {
        uint256 stakedAmount = stakedTokens[msg.sender][projectId];
        require(stakedAmount >= amount, "error_notEnoughTokensStaked");
        _unstake(projectId, amount, msg.sender);
    }

    /**
     * @notice Get the total amount staked on a given projectId across all users.
     * @param projectId The project to get the total staked amount for.
     * @return projectStake The total amount of tokens staked for the project.
     */
    function getProjectStake(bytes32 projectId) external view projectExists(projectId) returns (uint256 projectStake) {
        return stakedTokensByProject[projectId];
    }

    /**
     * @notice Get the total amount staked for a user across all projects.
     * @param userAddress The user to get the total staked amount for.
     * @return userStake The total amount of tokens staked for the user.
     */
    function getUserStake(address userAddress) external view returns (uint256 userStake) {
        return stakedTokensByUser[userAddress];
    }

    /**
     * @notice Get the total amount of tokens staked across all users and projects.
     * @return totalStake The total amount of tokens staked for all user accross all project.
     */
    function getTotalStake() external view returns (uint256 totalStake) {
        return totalStakedTokens;
    }

    function _stake(bytes32 projectId, uint256 amount, address staker) internal {
        stakedTokens[staker][projectId] += amount;
        stakedTokensByProject[projectId] += amount;
        stakedTokensByUser[staker] += amount;
        totalStakedTokens += amount;
        emit Stake(projectId, staker, amount);
    }

    function _unstake(bytes32 projectId, uint256 amount, address staker) internal {
        stakedTokens[staker][projectId] -= amount;
        stakedTokensByProject[projectId] -= amount;
        stakedTokensByUser[staker] -= amount;
        totalStakedTokens -= amount;
        IERC20(stakingTokenAddress).transfer(staker, amount);
        emit Unstake(projectId, staker, amount);
    }
}
