// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC677 is IERC20 {
    function transferAndCall(
        address to,
        uint value,
        bytes calldata data
    ) external returns (bool success);

    // renamed to avoid `Duplicate definition of Transfer (Transfer(address,address,uint256,bytes), Transfer(address,address,uint256))`
    event TransferAndCall(
        address indexed from,
        address indexed to,
        uint value,
        bytes data
    );
}
