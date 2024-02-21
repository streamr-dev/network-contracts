#!/usr/bin/env bash
set -euxo pipefail

npm run build

# export CHAIN=dev2
# export KEY=0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0

export CHAIN=polygon
export GAS_PRICE_GWEI=150
# export KEY=[from 1password]
# export ETHERSCAN_KEY=[from *scan],

export OUTPUT_FILE=operatorTemplate.txt
./scripts/upgradeOperatorTemplate.ts
export ADDRESS=$(cat $OUTPUT_FILE)
npm run verify

export OUTPUT_FILE=undelegationPolicy.txt
./scripts/upgradeUndelegationPolicy.ts
export ADDRESS=$(cat $OUTPUT_FILE)
npm run verify

# upgrade can't be done in dev-docker without replacing StreamrConfig deployment with upgrades
# this then would require re-thinking streamrEnvDeployer
# TODO: maybe it wouldn't be so bad to use hardhat in dev-chain-fast deployment?
# exit 0

export OUTPUT_FILE=streamrConfig.txt
export SCRIPT_FILE=./scripts/upgradeStreamrConfig.ts
npm run hardhatScript
export ADDRESS=$(cat $OUTPUT_FILE)
npm run verify

# 172800 = 3600 * 48 = 2 days
./scripts/streamrConfig.ts setMinimumDelegationSeconds 172800

rm $OUTPUT_FILE
