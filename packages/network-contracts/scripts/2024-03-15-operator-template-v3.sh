#!/usr/bin/env bash
set -euxo pipefail

npm run build

# export CHAIN=dev2
# export KEY=0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0

export CHAIN=polygon
export GAS_PRICE_GWEI=170
# export KEY=[from 1password]
# export ETHERSCAN_KEY=[from *scan],

export OUTPUT_FILE=undelegationPolicy.txt
./scripts/upgradeUndelegationPolicy.ts
export ADDRESS=$(cat undelegationPolicy.txt)
npm run verify

export OUTPUT_FILE=address.txt
./scripts/upgradeOperatorTemplate.ts
export ADDRESS=$(cat operatorTemplate-address.txt)
npm run verify
export ADDRESS=$(cat nodeModule-address.txt)
npm run verify
export ADDRESS=$(cat queueModule-address.txt)
npm run verify
export ADDRESS=$(cat stakeModule-address.txt)
npm run verify
