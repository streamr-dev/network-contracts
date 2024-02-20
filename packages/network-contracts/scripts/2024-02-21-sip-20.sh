#!/usr/bin/env bash
set -euxo pipefail

#npm run build

# export CHAIN=dev2
# export KEY=0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0

export CHAIN=polygon
export GAS_PRICE_GWEI=200
# export KEY=[from 1password]
# export ETHERSCAN_KEY=[from *scan],

# changing from lower values (5, 50, 0.001, 1.5, 0.5) better change the "incomes" (stake, slashing) first
# if we were changing from higher values, we'd change the "expenses" (rewards) first
./scripts/streamrConfig.ts setFlagStakeWei 50
./scripts/streamrConfig.ts setEarlyLeaverPenaltyWei 5000
./scripts/streamrConfig.ts setSlashingFraction 0.01
./scripts/streamrConfig.ts setFlaggerRewardWei 36
./scripts/streamrConfig.ts setFlagReviewerRewardWei 2
