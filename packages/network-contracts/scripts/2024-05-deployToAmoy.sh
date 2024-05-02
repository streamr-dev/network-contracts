#!/usr/bin/env bash
set -euxo pipefail

export CHAIN=polygonAmoy
export SCRIPT_FILE=scripts/deployStreamrContracts.ts
npm run hardhatScript

npm run deployTokenomicsContracts
