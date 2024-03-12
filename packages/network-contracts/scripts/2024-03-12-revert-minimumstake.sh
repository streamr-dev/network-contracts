#!/usr/bin/env bash
set -euxo pipefail

#npm run build

# export CHAIN=dev2
# export KEY=0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0

export CHAIN=polygon
export GAS_PRICE_GWEI=1000
# export KEY=[from 1password]
# export ETHERSCAN_KEY=[from *scan],

./scripts/streamrConfig.ts setEarlyLeaverPenaltyWei 5000
./scripts/streamrConfig.ts setFlaggerRewardWei 36
./scripts/streamrConfig.ts setFlagReviewerRewardWei 2

# double check, should be back to 5000 DATA
./scripts/streamrConfig.ts minimumStakeWei