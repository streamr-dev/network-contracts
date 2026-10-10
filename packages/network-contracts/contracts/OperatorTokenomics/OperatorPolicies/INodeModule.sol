// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../Sponsorship.sol";

interface INodeModule {
    function createCoordinationStream() external;
    function _setNodeAddresses(address[] calldata newNodes) external;
    function _updateNodeAddresses(address[] calldata addNodes, address[] calldata removeNodes) external;
    function _rebalanceStake(
        Sponsorship[] calldata reduceStakeFromSponsorships,
        uint[] calldata reducedTargetStakesWei,
        Sponsorship[] calldata stakeOnSponsorships,
        uint[] calldata stakeAmountsWei
    ) external;
}