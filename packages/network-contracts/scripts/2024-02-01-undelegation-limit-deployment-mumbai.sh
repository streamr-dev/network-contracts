#!/usr/bin/env bash
set -euxo pipefail

export CHAIN=dev2  #mumbai
#export KEY=[from 1password]

npx ts-node scripts/streamrConfig.ts setSlashingFraction 1000000000000000000000000
