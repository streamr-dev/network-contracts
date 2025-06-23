#!/usr/bin/env npx ts-node

import { writeFileSync } from "fs"

import { Contract, providers, utils } from "ethers"

import { config } from "@streamr/config"

import { streamRegistryABI } from "@streamr/network-contracts"
import type { StreamRegistry } from "@streamr/network-contracts"

import { deployedBytecode as deployed1 } from "../../artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json"
import { deployedBytecode as deployed2 } from "../../artifacts/contracts/StreamRegistry/StreamRegistryV2.sol/StreamRegistryV2.json"
import { deployedBytecode as deployed3 } from "../../artifacts/contracts/StreamRegistry/StreamRegistryV3.sol/StreamRegistryV3.json"
import { deployedBytecode as deployed4 } from "../../artifacts/contracts/StreamRegistry/StreamRegistryV4.sol/StreamRegistryV4.json"
import { deployedBytecode as deployed5 } from "../../artifacts/contracts/StreamRegistry/StreamRegistryV5.sol/StreamRegistryV5.json"

const { log } = console
const { getAddress } = utils

const chainArgs = process.argv.filter((arg) => Object.keys(config).includes(arg))
const chainNames = chainArgs.length > 0 ? chainArgs : ["polygon", "peaq"]

//bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const UUPS_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"

checkDeployments(chainNames).catch(console.error)
// dumpBytecodes().catch(console.error)

export async function dumpBytecodes(): Promise<void> {
    writeFileSync("deployed-1.txt", deployed1)
    writeFileSync("deployed-2.txt", deployed2)
    writeFileSync("deployed-3.txt", deployed3)
    writeFileSync("deployed-4.txt", deployed4)
    writeFileSync("deployed-5.txt", deployed5)
    for (const chainName of chainNames) {
        const chainKey = chainName as keyof typeof config
        const {
            rpcEndpoints,
            contracts
        } = config[chainKey]

        const streamRegistryAddress = (contracts as any).StreamRegistry
        const provider = new providers.JsonRpcProvider(rpcEndpoints[0]!.url)
        const uupsSlotData = await provider.getStorageAt(streamRegistryAddress, UUPS_SLOT)
        const implementationAddress = getAddress("0x" + uupsSlotData.slice(26)) // last 20 bytes
        const bytecode = await provider.getCode(implementationAddress)
        writeFileSync(`bytecode-${chainName}-${implementationAddress}.txt`, bytecode)
    }
    log("done")
}

async function checkDeployments(chainNames: string[]) {
    for (const chainName of chainNames) {
        const chainKey = chainName as keyof typeof config
        await checkChain(chainKey)
    }
}

function findContractName(bytecode: string) {
    if (bytecode === deployed1) {
        return "StreamRegistry"
    }
    if (bytecode === deployed2) {
        return "StreamRegistryV2"
    }
    if (bytecode === deployed3) {
        return "StreamRegistryV3"
    }
    if (bytecode === deployed4) {
        return "StreamRegistryV4"
    }
    if (bytecode === deployed5) {
        return "StreamRegistryV5"
    }
    return "UNKNOWN"
}

async function checkStreamRegistry(provider: providers.BaseProvider, address: string) {
    // TODO: find UUPS bytecode versions
    // const uupsBytecode = await provider.getCode(address)

    const uupsSlotData = await provider.getStorageAt(address, UUPS_SLOT)
    log(`UUPS slot data: ${uupsSlotData}`)
    const implementationAddress = getAddress("0x" + uupsSlotData.slice(26)) // last 20 bytes
    log(`Implementation address: ${implementationAddress}`)
    const byteCode = await provider.getCode(implementationAddress)

    const contractName = findContractName(byteCode)
    log(`Contract bytecode match: ${contractName}`)

    const streamRegistry = new Contract(address, streamRegistryABI, provider) as StreamRegistry

    // test userId hashing
    const testStreamId = "0xc0147a6a8e21be06edb0703b008f0e732ceea531/peaq/DePIN_1"
    const testAddress = "0xc0147a6a8e21be06edb0703b008f0e732ceea531"
    const key1 = await streamRegistry.getAddressKey(testStreamId, testAddress).catch((e) => `CALL FAILED: ${e.message}`)
    log(`getAddressKey hashes to: ${key1}`)
    const key2 = await streamRegistry.getUserKeyForUserId(testStreamId, testAddress).catch((e) => `CALL FAILED: ${e.message}`)
    log(`getUserKeyForUserId hashes to: ${key2}`)

    // test *forUserId view functions
    const perms1 = await streamRegistry.getPermissionsForUser(testStreamId, testAddress).catch((e) => `CALL FAILED: ${e.message}`)
    log(`getPermissionsForUser: ${perms1}`)
    const perms2 = await streamRegistry.getPermissionsForUserId(testStreamId, testAddress).catch((e) => `CALL FAILED: ${e.message}`)
    log(`getPermissionsForUserId: ${perms2}`)

    const direct1 = await streamRegistry.getDirectPermissionsForUser(testStreamId, testAddress).catch((e) => `CALL FAILED: ${e.message}`)
    log(`getDirectPermissionsForUser: ${direct1}`)
    const direct2 = await streamRegistry.getDirectPermissionsForUserId(testStreamId, testAddress).catch((e) => `CALL FAILED: ${e.message}`)
    log(`getDirectPermissionsForUserId: ${direct2}`)

    return contractName
}

async function checkChain(chainKey: keyof typeof config) {
    const {
        rpcEndpoints,
        contracts
    } = config[chainKey]

    const streamRegistryAddress = (contracts as any).StreamRegistry
    if (!streamRegistryAddress) {
        log("No StreamRegistry address found in config for %s", chainKey)
        return
    }
    log(`Checking ${streamRegistryAddress} in ${chainKey}`)

    const provider = new providers.JsonRpcProvider(rpcEndpoints[0]!.url)
    if (await provider.getNetwork().catch(() => null) == null) {
        log("Bad provider URL: ", rpcEndpoints[0]!.url)
        return
    }

    await checkStreamRegistry(provider, streamRegistryAddress)
}
