#!/usr/bin/env bash
set -euxo pipefail

if declare -p KEY >/dev/null 2>&1; then
    echo "Using deployer private key from environment variable KEY"
else
    read -p "Enter deployer private key: " KEY
    export KEY="$KEY"
fi

export CHAIN=iotex
# export CHAIN=iotexTestnet
# export CHAIN=dev2
# export IGNORE_TOKEN_SYMBOL=1
# export IGNORE_BALANCE=1
export OUTPUT_FILE=addresses.json
export SCRIPT_FILE=scripts/deployTokenomicsContracts.ts
npm run hardhatScript

export ADDRESS=$(jq -r '.StreamrConfig' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.SponsorshipOperatorContractOnlyJoinPolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.SponsorshipMaxOperatorsJoinPolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.SponsorshipStakeWeightedAllocationPolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.SponsorshipDefaultLeavePolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.SponsorshipVoteKickPolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.SponsorshipFactory' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.OperatorDefaultDelegationPolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.OperatorDefaultExchangeRatePolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.OperatorDefaultUndelegationPolicy' addresses.json)
npm run verify

export ADDRESS=$(jq -r '.OperatorFactory' addresses.json)
npm run verify
