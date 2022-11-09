#!/bin/bash
set -ex

mkdir -p abis
jq .abi ../hub-contracts/artifacts/contracts/ProjectRegistry/ProjectRegistry.sol/ProjectRegistry.json > abis/ProjectRegistry.json
