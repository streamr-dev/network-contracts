/* eslint-disable no-console */
import fs from "fs"

import { Contract } from "@ethersproject/contracts"
import { JsonRpcProvider } from "@ethersproject/providers"
import { Wallet } from "@ethersproject/wallet"

import * as namehash from "eth-ens-namehash"

import { config } from "@streamr/config"
import { streamRegistryABI, ensRegistryABI, ENSCacheV2ABI } from "@streamr/network-contracts"
import type { ENS, StreamRegistry, ENSCacheV2 } from "@streamr/network-contracts"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    DELAY = "0",
    GAS_PRICE_MULTIPLIER,

    // Easy setting: read addresses and URLs from @streamr/config
    ENS_CHAIN = "dev2",
    REGISTRY_CHAIN = "dev2",

    // Individual overrides
    ENS_RPC_URL,
    REGISTRY_RPC_URL,
    ENS_ADDRESS,
    REGISTRY_ADDRESS,
    ENS_CACHE_ADDRESS,
    HEARTBEAT_FILENAME,
} = process.env

if (isNaN(parseFloat(GAS_PRICE_MULTIPLIER || "1.0"))) {
    throw new Error(`GAS_PRICE_MULTIPLIER="${GAS_PRICE_MULTIPLIER}" is not a valid number! Try e.g. "1.5"`)
}

const ensChainRpc = ENS_RPC_URL ?? (config as any)[ENS_CHAIN]?.rpcEndpoints?.[0]?.url
if (!ensChainRpc) { throw new Error(`Either ENS_CHAIN or ENS_RPC_URL must be set in environment`) }
const ensChainProvider = new JsonRpcProvider(ensChainRpc)

const registryChainRpc = REGISTRY_RPC_URL ?? (config as any)[REGISTRY_CHAIN]?.rpcEndpoints?.[0]?.url
if (!registryChainRpc) { throw new Error(`Either REGISTRY_CHAIN or REGISTRY_RPC_URL must be set in environment`) }
const registryChainProvider = new JsonRpcProvider(registryChainRpc)
const registryChainWallet = new Wallet(KEY, registryChainProvider)
log("Wallet address used by script: ", registryChainWallet.address)

const ensAddress = ENS_ADDRESS ?? (config as any)[ENS_CHAIN]?.contracts?.ENS
if (!ensAddress) { throw new Error(`Either ENS_CHAIN or ENS_ADDRESS must be set in environment`) }
const ensContract = new Contract(ensAddress, ensRegistryABI, ensChainProvider) as unknown as ENS

const registryAddress = REGISTRY_ADDRESS ?? (config as any)[REGISTRY_CHAIN]?.contracts?.StreamRegistry
if (!registryAddress) { throw new Error(`Either REGISTRY_CHAIN or REGISTRY_ADDRESS must be set in environment`) }
const streamRegistryContract = new Contract(registryAddress, streamRegistryABI, registryChainProvider) as unknown as StreamRegistry

const ensCacheAddress = ENS_CACHE_ADDRESS ?? (config as any)[REGISTRY_CHAIN]?.contracts?.ENSCacheV2
if (!ensCacheAddress) { throw new Error(`Either REGISTRY_CHAIN or ENS_CACHE_ADDRESS must be set in environment`) }
const ensCacheContract = new Contract(ensCacheAddress, ENSCacheV2ABI, registryChainWallet) as unknown as ENSCacheV2

const delay = (parseInt(DELAY) || 0) * 1000
if (delay > 0) { log(`Starting with answer delay ${delay} milliseconds`) }

let mutex = Promise.resolve(true)

const AddressZero = "0x0000000000000000000000000000000000000000"
const Bytes32Zero = "0x0000000000000000000000000000000000000000000000000000000000000000"
async function main() {
    log("Checking the network setup: %o", await ensChainProvider.getNetwork())
    log("ENS contract at: %s (deployer %s)", ensContract.address, await ensContract.owner(Bytes32Zero))
    log("StreamRegistry contract at: %s (%s)", streamRegistryContract.address, await streamRegistryContract.TRUSTED_ROLE())
    log("ENSCacheV2 contract at: %s (%s)", ensCacheContract.address, await ensCacheContract.owners(AddressZero))

    log("Starting listening for events on ENSCacheV2 contract: ", ensCacheContract.address)
    ensCacheContract.on("RequestENSOwnerAndCreateStream", async (ensName, streamIdPath, metadataJsonString, requestorAddress) => {
        log("Got RequestENSOwnerAndCreateStream event params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
        if (delay) {
            log("sleeping for ", delay, "ms")
            await sleep(delay)
        }
        const oldMutex = mutex
        mutex = new Promise(async (resolve) => {
            await oldMutex
            await handleEvent(ensName, streamIdPath, metadataJsonString, requestorAddress)
            resolve(true)
        })
    })

    // log("starting listening for createstream events on StreamRegistry contract: ", streamRegistryContract.address)
    // streamRegistryContract.on("StreamCreated", async (streamId, metadataJsonString) => {
    //     log("Got StreamCreated event params: ", streamId, metadataJsonString)
    // })

    // initial heartbeat (5 seconds safety margin to wait for contract listener to be active)
    setTimeout(() => {
        log("Sending initial heartbeat")
        fs.writeFileSync(HEARTBEAT_FILENAME || `heartbeat-${ENS_CHAIN}-${REGISTRY_CHAIN}`, "")
    }, 5 * 1000)
    // thereafter send heartbeat every 2 minutes
    setInterval(() => {
        log("sending heartbeat")
        fs.writeFileSync(HEARTBEAT_FILENAME || `heartbeat-${ENS_CHAIN}-${REGISTRY_CHAIN}`, "")
    }, 2 * 60 * 1000)
}

async function handleEvent(ensName: string, streamIdPath: string, metadataJsonString: string, requestorAddress: string) {
    log("handleEvent params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
    const ensHashedName = namehash.hash(ensName)
    log("Hashed name: ", ensHashedName)
    const owner = await ensContract.owner(ensHashedName)
    log("ENS owner queried from mainnet: ", owner)

    if (requestorAddress === owner) {
        await createStream(ensName, streamIdPath, metadataJsonString, requestorAddress, true)
    } else {
        log(`Requestor ${requestorAddress} is not owner ${owner}, ignoring request`)
    }
}

async function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function createStream(ensName: string, streamIdPath: string, metadataJsonString: string, requestorAddress: string, retry = false) {

    if (await streamRegistryContract.exists(ensName + streamIdPath)) {
        log("stream already exists, not creating")
        return
    }

    log("creating stream from ENS name: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
    try {
        const tx = await ensCacheContract.populateTransaction.fulfillENSOwner(ensName, streamIdPath, metadataJsonString, requestorAddress)

        if (GAS_PRICE_MULTIPLIER) {
            const recommended = await registryChainProvider.getFeeData()
            const multiplier = parseFloat(GAS_PRICE_MULTIPLIER)
            if (recommended.maxFeePerGas && recommended.maxPriorityFeePerGas) {
                tx.maxFeePerGas = recommended.maxFeePerGas.mul(multiplier)
                tx.maxPriorityFeePerGas = recommended.maxPriorityFeePerGas.mul(multiplier)
            } else if (recommended.gasPrice) {
                tx.gasPrice = recommended.gasPrice.mul(multiplier)
            }
        }
        log("Sending fulfillENSOwner transaction: %o", tx)
        const tr = await registryChainWallet.sendTransaction(tx)
        log("Receipt: %o", tr)
    } catch (e) {
        log("creating stream failed, createStreamFromENS error: ", e)
        if (retry) {
            log("retrying")
            await createStream(ensName, streamIdPath, metadataJsonString, requestorAddress, false)
        }
    }
}

main().then(() => {
    log("listening for events...")
    return void 0
}).catch((err: any) => {
    log("error: ", err)
    process.exit(1)
})
