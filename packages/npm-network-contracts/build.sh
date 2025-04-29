#!/bin/bash
set -ex

rm -rf contracts artifacts typechain abis
cp -r ../network-contracts/contracts .

hardhat compile

# create minified ABIs
artifact_files=$(find artifacts/contracts -type f -name '*.json' ! -name '*.dbg.json')
artifact_files="${artifact_files}
artifacts/@streamr/data-v2/flattened/DATAv2.sol/DATAv2.json"
for artifact_file in $artifact_files; do
    abi_file="$(echo "$artifact_file" | sed 's#^artifacts/#abis/#')"
    mkdir -p "$(dirname "$abi_file")"
    jq '.abi' "$artifact_file" > "$abi_file"
    node minify-abi.mjs "$abi_file"
done

rm -rf dist
tsc
