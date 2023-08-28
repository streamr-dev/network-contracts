#!/bin/bash
set -ex

# start in this script's directory
cd "$(dirname "$0")"

npm run clean
cd ../..
npm run build -w @streamr/network-contracts
npm run build -w @streamr/hub-contracts
cd packages/network-contracts
rm -f streamr-network-contracts-*.tgz
npm pack
cd ../hub-contracts
rm -f streamr-hub-contracts-*.tgz
npm pack
cd ../dev-chain-fast
npm i ../network-contracts/streamr-network-contracts-*.tgz
npm i ../hub-contracts/streamr-hub-contracts-*.tgz
rm -f ../network-contracts/streamr-network-contracts-*.tgz
rm -f ../hub-contracts/streamr-hub-contracts-*.tgz
