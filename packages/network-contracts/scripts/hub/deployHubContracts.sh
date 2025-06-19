#!/usr/bin/env bash
set -euxo pipefail

if declare -p KEY >/dev/null 2>&1; then
    echo "Using deployer private key from environment variable KEY"
else
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

export CHAIN=iotex
export OUTPUT_FILE=address.txt
npx hardhat run --network $CHAIN scripts/deployProjectRegistry.ts
export PROJECT_REGISTRY_ADDRESS=$(cat address.txt)
npx hardhat run --network $CHAIN scripts/deployProjectStakingV1.ts
npx hardhat run --network $CHAIN scripts/deployMarketplaceV4.ts
rm address.txt
