#!/bin/bash
set -ex

rm -rf artifacts
hardhat compile
cp  ../../node_modules/@ensdomains/ens-contracts/deployments/archive/PublicResolver_mainnet_9412610.sol/PublicResolver_mainnet_9412610.json artifacts/PublicResolver_mainnet_9412610.json

sleep 1

rm -rf dist
tsc -p tsconfig.build.json
