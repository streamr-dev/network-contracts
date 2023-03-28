#!/bin/bash
set -ex

mkdir -p abis
jq .abi ../network-contracts/artifacts/contracts/NodeRegistry/NodeRegistry.sol/NodeRegistry.json > abis/NodeRegistry.json
jq .abi ../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json > abis/StreamRegistry.json
jq .abi ../network-contracts/artifacts/contracts/StreamStorageRegistry/StreamStorageRegistry.sol/StreamStorageRegistry.json > abis/StreamStorageRegistry.json

jq .abi ../network-contracts/artifacts/contracts/BrokerEconomics/Bounty.sol/Bounty.json > abis/Bounty.json
jq .abi ../network-contracts/artifacts/contracts/BrokerEconomics/BountyFactory.sol/BountyFactory.json > abis/BountyFactory.json
jq .abi ../network-contracts/artifacts/contracts/BrokerEconomics/BrokerPool.sol/BrokerPool.json > abis/BrokerPool.json
jq .abi ../network-contracts/artifacts/contracts/BrokerEconomics/BrokerPoolFactory.sol/BrokerPoolFactory.json > abis/BrokerPoolFactory.json

jq .abi ../hub-contracts/artifacts/contracts/ProjectRegistry/ProjectRegistryV1.sol/ProjectRegistryV1.json > abis/ProjectRegistryV1.json
jq .abi ../hub-contracts/artifacts/contracts/Marketplace/MarketplaceV4.sol/MarketplaceV4.json > abis/MarketplaceV4.json
jq .abi ../hub-contracts/artifacts/contracts/ProjectStaking/ProjectStakingV1.sol/ProjectStakingV1.json > abis/ProjectStakingV1.json
