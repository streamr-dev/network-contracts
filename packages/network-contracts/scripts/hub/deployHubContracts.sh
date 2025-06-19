#!/usr/bin/env bash
set -euxo pipefail

if declare -p KEY >/dev/null 2>&1; then
    echo "Using deployer private key from environment variable KEY"
else
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

if declare -p CHAIN >/dev/null 2>&1; then
    echo "Using chain from environment variable CHAIN"
else
    read -p "Enter chain: " CHAIN
    export CHAIN="$CHAIN"
fi

export OUTPUT_FILE=address.txt
npx hardhat run --network $CHAIN scripts/hub/deployProjectRegistry.ts
export PROJECT_REGISTRY_ADDRESS=$(cat address.txt)
npx hardhat run --network $CHAIN scripts/hub/deployProjectStakingV1.ts
npx hardhat run --network $CHAIN scripts/hub/deployMarketplaceV4.ts
rm address.txt
