#!/bin/sh

cd ../..
npx hardhat flatten packages/network-contracts/contracts/OperatorTokenomics/Operator.sol > temp.sol
grep -v SPDX-License-Identifier temp.sol > temp2.sol
grep -v "pragma experimental" temp2.sol > temp.sol
echo // SPDX-License-Identifier: MIT > sol
echo pragma experimental ABIEncoderV2; >> sol
cat temp.sol >> sol
docker run -v .:/Operator ethereum/solc:0.8.13 --hashes Operator/sol > packages/network-contracts/selectors.txt
rm temp.sol temp2.sol sol
