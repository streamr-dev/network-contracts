#!/bin/bash
set -ex

mkdir -p abis
jq .abi ../hub-contracts/artifacts/contracts/ProjectRegistry/ProjectRegistryV1.sol/ProjectRegistryV1.json > abis/ProjectRegistryV1.json
jq .abi ../hub-contracts/artifacts/contracts/Marketplace/MarketplaceV4.sol/MarketplaceV4.json > abis/MarketplaceV4.json
jq .abi ../hub-contracts/artifacts/contracts/ProjectStaking/ProjectStakingV1.sol/ProjectStakingV1.json > abis/ProjectStakingV1.json
