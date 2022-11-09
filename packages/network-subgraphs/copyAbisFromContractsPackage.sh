#!/bin/bash
set -ex

jq .abi ../network-contracts/artifacts/contracts/NodeRegistry/NodeRegistry.sol/NodeRegistry.json > abis/NodeRegistry.json
jq .abi ../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json > abis/StreamRegistry.json
jq .abi ../network-contracts/artifacts/contracts/StreamStorageRegistry/StreamStorageRegistry.sol/StreamStorageRegistry.json > abis/StreamStorageRegistry.json
