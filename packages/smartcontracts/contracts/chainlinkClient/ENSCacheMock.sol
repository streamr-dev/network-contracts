// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.0;

import "./ENSCache.sol";

contract ENSCacheMock is ENSCache {
  // address public resolvedEnsAddress;
  constructor (address oracleaddress, string memory chainlinkJobId, string memory ensdomain, address owneraddress) public ENSCache(oracleaddress, chainlinkJobId) {
    owners[ensdomain] = owneraddress;
  }
}