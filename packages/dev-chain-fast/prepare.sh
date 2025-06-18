#!/bin/bash
set -ex

# start in this script's directory
cd "$(dirname "$0")"

npm run clean
rm -f streamr-network-contracts-*.tgz
cd ../..
npm run build -w @streamr/network-contracts
cd packages/network-contracts
npm pack
mv streamr-network-contracts-*.tgz ../dev-chain-fast
cd ../dev-chain-fast
npm run build
