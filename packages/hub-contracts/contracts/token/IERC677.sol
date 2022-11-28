// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// adapted from LINK token https://etherscan.io/address/0x514910771af9ca656af840dff83e8264ecf986ca#code
// implements https://github.com/ethereum/EIPs/issues/677
interface IERC677 is IERC20 {
    function transferAndCall(
        address to,
        uint value,
        bytes calldata data
    ) external returns (bool success);

    event Transfer(
        address indexed from,
        address indexed to,
        uint value,
        bytes data
    );
}
