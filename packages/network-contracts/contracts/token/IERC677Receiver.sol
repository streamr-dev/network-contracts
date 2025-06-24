// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC677Receiver {
    /** @dev onTokenTransfer implementation MUST start with check that `msg.sender == tokenAddress` */
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _data
    ) external;
}
