#!/usr/bin/env bash
set -euxo pipefail

if declare -p KEY >/dev/null 2>&1; then
    echo "Using deployer private key from environment variable KEY"
else
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

export CHAIN=iotex
# export CHAIN=iotexTestnet
# export CHAIN=dev2
# export IGNORE_TOKEN_SYMBOL=1
export OUTPUT_FILE=addresses.json
export SCRIPT_FILE=scripts/deployStreamrContracts.ts
npm run hardhatScript

export ADDRESS=$(jq -r '.StreamRegistry' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.ENSCacheV2' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.StorageNodeRegistry' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.StreamStorageRegistry' addresses.json)
npm run verify

cat addresses.json
