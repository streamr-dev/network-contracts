// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ISlashListener {
    function onSlash(bool alsoKicked) external;
}
