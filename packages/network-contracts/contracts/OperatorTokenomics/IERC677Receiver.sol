// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IERC677Receiver {
    /** @dev onTokenTransfer implementation MUST start with check that `msg.sender == tokenAddress` */
    function onTokenTransfer(address sender, uint256 value, bytes calldata data) external;
}
