#!/usr/bin/env bash
set -euxo pipefail

if [ -z "$KEY" ]; then
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

export CHAIN=iotexTestnet
export SCRIPT_FILE=scripts/deployStreamrContracts.ts
npm run hardhatScript

read -p "Copy changed addresses to config, then press enter"

export SCRIPT_FILE=scripts/deployTokenomicsContracts.ts
npm run hardhatScript
