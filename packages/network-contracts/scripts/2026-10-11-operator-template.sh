#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Deploys the new Operator template and its modules (NodeModule, QueueModule, StakeModule) to Polygon
#   and verifies their source code on PolygonScan.
# Does NOT call OperatorFactory.updateTemplates; that is done by the ADMIN_ROLE multisig
#   (the calldata for it is printed by deployOperatorTemplate.ts).

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

export OUTPUT_FILE=address.txt
./scripts/deployOperatorTemplate.ts

ADDRESS=$(cat operatorTemplate-address.txt) CONTRACT=contracts/OperatorTokenomics/Operator.sol:Operator ./scripts/verifyEtherscanV2.ts
ADDRESS=$(cat nodeModule-address.txt) CONTRACT=contracts/OperatorTokenomics/OperatorPolicies/NodeModule.sol:NodeModule ./scripts/verifyEtherscanV2.ts
ADDRESS=$(cat queueModule-address.txt) CONTRACT=contracts/OperatorTokenomics/OperatorPolicies/QueueModule.sol:QueueModule ./scripts/verifyEtherscanV2.ts
ADDRESS=$(cat stakeModule-address.txt) CONTRACT=contracts/OperatorTokenomics/OperatorPolicies/StakeModule.sol:StakeModule ./scripts/verifyEtherscanV2.ts

set +x
echo
echo "New Operator template: $(cat operatorTemplate-address.txt)"
echo "New NodeModule:        $(cat nodeModule-address.txt)"
echo "New QueueModule:       $(cat queueModule-address.txt)"
echo "New StakeModule:       $(cat stakeModule-address.txt)"
for f in operatorTemplate nodeModule queueModule stakeModule; do
    echo "https://polygonscan.com/address/$(cat $f-address.txt)#code"
done
