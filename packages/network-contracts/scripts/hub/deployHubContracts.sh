#!/usr/bin/env bash
set -euxo pipefail

if declare -p KEY >/dev/null 2>&1; then
    echo "Using deployer private key from environment variable KEY"
else
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

#export CHAIN=iotex
export CHAIN=dev2
export OUTPUT_FILE=address.txt
npm run deploy-registry
export PROJECT_REGISTRY_ADDRESS=$(cat address.txt)
npm run deploy-staking
npm run deploy-marketplace
rm address.txt
