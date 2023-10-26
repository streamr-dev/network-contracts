#!/bin/sh

cd ../..
npx hardhat flatten packages/network-contracts/contracts/OperatorTokenomics/testcontracts/MockRandomOracle.sol > temp.sol
grep -v SPDX-License-Identifier temp.sol > temp2.sol
grep -v "pragma experimental" temp2.sol > temp.sol
echo // SPDX-License-Identifier: MIT > sol
echo pragma experimental ABIEncoderV2; >> sol
cat temp.sol >> sol
docker run -v .:/OperatorTokenomics ethereum/solc:0.8.13 --hashes OperatorTokenomics/sol > packages/network-contracts/selectors.txt
rm temp.sol temp2.sol sol
