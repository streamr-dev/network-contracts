#!/usr/bin/env bash
set -euxo pipefail

# export CHAIN=dev2
export CHAIN=polygonAmoy

export SCRIPT_FILE=scripts/upgradeVoteKickPolicy.ts
npm run hardhatScript
