#!/usr/bin/env bash
set -euxo pipefail

# export CHAIN=dev2
export CHAIN=polygonAmoy

read -p "Enter deployer private key: " KEY
export KEY="$KEY"

export CONTRACT_NAME=StreamRegistryV5
export OUTPUT_FILE=newImplementationAddress.txt
export SCRIPT_FILE=scripts/upgradeStreamRegistry.ts
npm run hardhatScript

read -p "Enter Polygonscan API key: " ETHERSCAN_KEY
export ETHERSCAN_KEY="$ETHERSCAN_KEY"

export ADDRESS=$(cat newImplementationAddress.txt)
npm run verify

rm newImplementationAddress.txt
