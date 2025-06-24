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

OUTPUT_FILE=project-registry-address.txt npx hardhat run --network $CHAIN scripts/hub/deployProjectRegistry.ts
export PROJECT_REGISTRY_ADDRESS=$(cat project-registry-address.txt)
OUTPUT_FILE=project-staking-address.txt npx hardhat run --network $CHAIN scripts/hub/deployProjectStakingV1.ts
OUTPUT_FILE=marketplace-address.txt npx hardhat run --network $CHAIN scripts/hub/deployMarketplaceV4.ts
set +x
echo "{"
echo "  \"ProjectRegistryV1\": \"$PROJECT_REGISTRY_ADDRESS\","
echo "  \"MarketplaceV4\": \"$(cat marketplace-address.txt)\","
echo "  \"ProjectStakingV1\": \"$(cat project-staking-address.txt)\""
echo "}"

rm project-registry-address.txt
rm project-staking-address.txt
rm marketplace-address.txt
