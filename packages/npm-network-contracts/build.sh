#!/bin/bash
set -ex

rm -rf contracts artifacts typechain
cp -r ../network-contracts/contracts .

hardhat compile

# copy the artifact file for deployed PublicResolver to avoid npm dependency (the file is NOT going to change or update!)
cp  ./node_modules/@ensdomains/ens-contracts/deployments/archive/PublicResolver_mainnet_9412610.sol/PublicResolver_mainnet_9412610.json artifacts/PublicResolver_mainnet_9412610.json

rm -rf dist
tsc

# create minified ABIs
artifact_files=$(find artifacts/contracts -type f -name '*.json' ! -name '*.dbg.json' | grep -v 'build-info')
for artifact_file in $artifact_files; do
    abi_file="$(dirname "$artifact_file")/$(basename "$artifact_file" .json)ABI.json"
    jq '.abi' "$artifact_file" > "$abi_file"
    node minify-abi.mjs "$abi_file"
done