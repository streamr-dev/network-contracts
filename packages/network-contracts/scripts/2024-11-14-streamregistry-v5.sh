#!/usr/bin/env bash
set -euxo pipefail

export CHAIN=polygon

# export CHAIN=polygonAmoy
# export GAS_PRICE_GWEI=30   # prevent error about zero gas price

if declare -p KEY >/dev/null 2>&1; then
    echo "Using deployer private key from environment variable KEY"
else
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

export CONTRACT_NAME=StreamRegistryV5
export OUTPUT_FILE=newImplementationAddress.txt
export SCRIPT_FILE=scripts/upgradeStreamRegistry.ts
npm run hardhatScript

# Verify & publish the contract source code on Polygonscan

if declare -p ETHERSCAN_KEY >/dev/null 2>&1; then
    echo "Using *scan API key from environment variable ETHERSCAN_KEY"
else
    read -p "Enter Polygonscan API key: " ETHERSCAN_KEY
    export ETHERSCAN_KEY="$ETHERSCAN_KEY"
fi

export ADDRESS=$(cat newImplementationAddress.txt)
npm run verify

rm newImplementationAddress.txt
