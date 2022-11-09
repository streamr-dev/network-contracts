#!/bin/bash
set -ex

jq .abi ../hub-contracts/artifacts/contracts/ProjectRegistry/ProjectRegistry.sol/ProjectRegistry.json > abis/ProjectRegistry.json
