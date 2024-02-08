#!/usr/bin/env bash
set -euxo pipefail

npm run build

# export CHAIN=dev2
# export KEY=0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0
# export GAS_PRICE_GWEI=123
export CHAIN=mumbai
# export KEY=[from 1password]
# export ETHERSCAN_KEY=[from *scan],
export OUTPUT_FILE=temp.txt

./scripts/upgradeOperatorTemplate.ts
# export ADDRESS=$(cat $OUTPUT_FILE)
# npm run verify

# ./scripts/upgradeUndelegationPolicy.ts
# export ADDRESS=$(cat $OUTPUT_FILE)
# npm run verify

# upgrade can't be done in dev-docker without replacing StreamrConfig deployment with upgrades
# this then would require re-thinking streamrEnvDeployer
# TODO: maybe it wouldn't be so bad to use hardhat in dev-chain-fast deployment?
# exit 0

# export SCRIPT_FILE=./scripts/upgradeStreamrConfig.ts
# npm run hardhatScript
# export ADDRESS=$(cat $OUTPUT_FILE)
# npm run verify

# 3600 * 24 = 1 day
# ./scripts/streamrConfig.ts setMinimumDelegationSeconds 86400

rm $OUTPUT_FILE
