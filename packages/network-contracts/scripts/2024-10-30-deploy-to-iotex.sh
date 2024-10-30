#!/usr/bin/env bash
set -euxo pipefail

if declare -p KEY >/dev/null 2>&1; then
    echo "Using deployer private key from environment variable KEY"
else
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

export CHAIN=iotex
export SCRIPT_FILE=scripts/deployStreamrContracts.ts
npm run hardhatScript

read -p "Copy changed addresses to config, then press enter"

export SCRIPT_FILE=scripts/deployTokenomicsContracts.ts
npm run hardhatScript
