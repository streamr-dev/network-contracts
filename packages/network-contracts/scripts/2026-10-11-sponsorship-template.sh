#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Deploys the new Sponsorship template to Polygon and verifies its source code on PolygonScan.
# Does NOT call SponsorshipFactory.updateTemplate; that is done by the ADMIN_ROLE multisig
#   (the calldata for it is printed by deploySponsorshipTemplate.ts).

# ---- Fill these in before running (never commit the values!) --------------------------------------------
export KEY="${KEY:-}"                      # deployer private key (0x...), needs POL for gas; does not need any role
export ETHERSCAN_KEY="${ETHERSCAN_KEY:-}"  # Etherscan API key (etherscan.io account; API v2 keys work for Polygon)
# ---------------------------------------------------------------------------------------------------------

export CHAIN="${CHAIN:-polygon}"
# export GAS_PRICE_GWEI=100                # optional override; default is the RPC's suggested gas price
# export ETHEREUM_RPC=https://...          # optional override; default is the first RPC in @streamr/config

if [ -z "$KEY" ]; then echo "KEY is not set (deployer private key)"; exit 1; fi
if [ -z "$ETHERSCAN_KEY" ]; then echo "ETHERSCAN_KEY is not set"; exit 1; fi

set -x
npm run build

export OUTPUT_FILE=sponsorshipTemplate-address.txt
./scripts/deploySponsorshipTemplate.ts

export ADDRESS=$(cat "$OUTPUT_FILE")
export CONTRACT=contracts/OperatorTokenomics/Sponsorship.sol:Sponsorship
./scripts/verifyEtherscanV2.ts

set +x
echo
echo "New Sponsorship template: $ADDRESS"
echo "https://polygonscan.com/address/$ADDRESS#code"
