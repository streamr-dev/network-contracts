#!/usr/bin/env bash
set -euxo pipefail

#npm run build

# export CHAIN=dev2
# export KEY=0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0

export CHAIN=polygon
export GAS_PRICE_GWEI=150
# export KEY=[from 1password]
# export ETHERSCAN_KEY=[from *scan],

# the idea of these temporary values is to enable operators to lose their tokens fast with early leaver penalties
# minimum stake becomes 1 DATA, to enable easy staking to the slashing sponsorship
# Calculation: 1% slashing fraction, 0.01 DATA fees => 1% of 1 DATA covers the fees

./scripts/streamrConfig.ts setEarlyLeaverPenaltyWei 1000000000
./scripts/streamrConfig.ts setFlaggerRewardWei 0.003
./scripts/streamrConfig.ts setFlagReviewerRewardWei 0.001

# double check
./scripts/streamrConfig.ts minimumStakeWei
