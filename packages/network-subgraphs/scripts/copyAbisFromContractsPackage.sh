#!/bin/bash
set -ex

pushd ../network-contracts
npm run build
popd

mkdir -p abis
jq .abi ../network-contracts/artifacts/contracts/NodeRegistry/NodeRegistry.sol/NodeRegistry.json > abis/NodeRegistry.json
jq .abi ../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV5.sol/StreamRegistryV5.json > abis/StreamRegistry.json
jq .abi ../network-contracts/artifacts/contracts/StreamStorageRegistry/StreamStorageRegistry.sol/StreamStorageRegistry.json > abis/StreamStorageRegistry.json

jq .abi ../network-contracts/artifacts/contracts/OperatorTokenomics/StreamrConfig.sol/StreamrConfig.json > abis/StreamrConfig.json
jq .abi ../network-contracts/artifacts/contracts/OperatorTokenomics/Sponsorship.sol/Sponsorship.json > abis/Sponsorship.json
jq .abi ../network-contracts/artifacts/contracts/OperatorTokenomics/SponsorshipFactory.sol/SponsorshipFactory.json > abis/SponsorshipFactory.json
jq .abi ../network-contracts/artifacts/contracts/OperatorTokenomics/Operator.sol/Operator.json > abis/Operator.json
jq .abi ../network-contracts/artifacts/contracts/OperatorTokenomics/OperatorFactory.sol/OperatorFactory.json > abis/OperatorFactory.json

jq .abi ../network-contracts/artifacts/contracts/Hub/ProjectRegistry/ProjectRegistryV1.sol/ProjectRegistryV1.json > abis/ProjectRegistryV1.json
jq .abi ../network-contracts/artifacts/contracts/Hub/Marketplace/MarketplaceV4.sol/MarketplaceV4.json > abis/MarketplaceV4.json
jq .abi ../network-contracts/artifacts/contracts/Hub/ProjectStaking/ProjectStakingV1.sol/ProjectStakingV1.json > abis/ProjectStakingV1.json
