// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "./ENSCache.sol";

contract ENSCacheMock is ENSCache {
  // address public resolvedEnsAddress;
  constructor (address oracleaddress, string memory chainlinkJobId, string memory ensdomain, address trustedForwarder, address owneraddress) 
   ENSCache(oracleaddress, chainlinkJobId, trustedForwarder) {
    owners[ensdomain] = owneraddress;
  }
}