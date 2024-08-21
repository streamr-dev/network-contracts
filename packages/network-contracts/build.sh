#!/bin/bash
set -ex

rm -rf artifacts
hardhat compile
cp  ../../node_modules/@ensdomains/ens-contracts/deployments/archive/PublicResolver_mainnet_9412610.sol/PublicResolver_mainnet_9412610.json artifacts/PublicResolver_mainnet_9412610.json

rm -rf dist
tsc -p tsconfig.build.json

# this requires a running Docker daemon
if docker ps > /dev/null 2>&1; then
  ./generateSelectorsTxt.sh
else
  echo "Docker is not running, skipping generateSelectorsTxt.sh"
fi
