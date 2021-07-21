#!/bin/bash
set -ex

# start in this /scripts directory
cd "$(dirname "$0")"

cd ../packages/smartcontracts
npm run build
jq .abi artifacts/contracts/NodeRegistry/NodeRegistry.sol/NodeRegistry.json > ../streamregistry-thegraph-subgraph/abis/NodeRegistry.json
jq .abi artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json > ../streamregistry-thegraph-subgraph/abis/StreamRegistry.json
jq .abi artifacts/contracts/StreamStorageRegistry/StreamStorageRegistry.sol/StreamStorageRegistry.json > ../streamregistry-thegraph-subgraph/abis/StreamStorageRegistry.json
