import { keccak256 } from "@ethersproject/keccak256"

import * as contracts from "./contractExports"

// generate extcodehash for each contract
export const operatorCodehash = keccak256(contracts.operatorBytecode)
export const sponsorshipCodehash = keccak256(contracts.sponsorshipBytecode)
export const operatorFactoryCodehash = keccak256(contracts.operatorFactoryBytecode)
export const sponsorshipFactoryCodehash = keccak256(contracts.sponsorshipFactoryBytecode)
export const streamrConfigCodehash = keccak256(contracts.streamrConfigBytecode)
export const streamRegistryCodehash = keccak256(contracts.streamRegistryBytecode)
export const streamStorageRegistryCodehash = keccak256(contracts.streamStorageRegistryBytecode)
export const ENSCacheV2Codehash = keccak256(contracts.ENSCacheV2Bytecode)
export const nodeRegistryCodehash = keccak256(contracts.nodeRegistryBytecode)
export const tokenCodehash = keccak256(contracts.tokenBytecode)
export const maxOperatorsJoinPolicyCodehash = keccak256(contracts.maxOperatorsJoinPolicyBytecode)
export const stakeWeightedAllocationPolicyCodehash = keccak256(contracts.stakeWeightedAllocationPolicyBytecode)
export const defaultLeavePolicyCodehash = keccak256(contracts.defaultLeavePolicyBytecode)
export const voteKickPolicyCodehash = keccak256(contracts.voteKickPolicyBytecode)
export const defaultDelegationPolicyCodehash = keccak256(contracts.defaultDelegationPolicyBytecode)
export const defaultExchangeRatePolicyCodehash = keccak256(contracts.defaultExchangeRatePolicyBytecode)
export const defaultUndelegationPolicyCodehash = keccak256(contracts.defaultUndelegationPolicyBytecode)
export const operatorContractOnlyJoinPolicyCodehash = keccak256(contracts.operatorContractOnlyJoinPolicyBytecode)
export const ensRegistryCodehash = keccak256(contracts.ensRegistryBytecode)
export const fifsRegistrarCodehash = keccak256(contracts.fifsRegistrarBytecode)
export const publicResolverCodehash = keccak256(contracts.publicResolverBytecode)
export const nodeModuleCodehash = keccak256(contracts.nodeModuleBytecode)
export const queueModuleCodehash = keccak256(contracts.queueModuleBytecode)
export const stakeModuleCodehash = keccak256(contracts.stakeModuleBytecode)

export * from "./contractExports"
export * from "./StreamrEnvDeployer"
