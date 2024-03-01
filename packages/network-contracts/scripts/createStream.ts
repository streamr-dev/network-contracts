#!/usr/bin/env npx ts-node

// Steps for running this file:
//   start dev env: streamr-docker-dev start dev-chain-fast
//   Optional: `export ENS_NAME=my-ens-name.eth`
//   Optional: `export STREAM_NAME=streamName`
//   `export METADATA={}`
//   `npx tsx scripts/createStream.ts` `[` `streamName` `]`

import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { namehash } from "@ethersproject/hash"
import type { Listener } from "@ethersproject/abstract-provider"
import type { Event } from "@ethersproject/contracts"

import { config } from "@streamr/config"
import { streamRegistryABI, ensRegistryABI, ENSCacheV2ABI } from "@streamr/network-contracts"
import type { StreamRegistry, ENS, ENSCacheV2 } from "@streamr/network-contracts"

import { formatReceipt, formatEvent, formatPermissions } from "./prettyPrint"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    ENS_NAME,
    STREAM_NAME,
    METADATA,

    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",

    // Easy setting: read addresses and URLs from @streamr/config
    ENS_CHAIN = "dev2",
    REGISTRY_CHAIN = "dev2",

    // Individual overrides
    ENS_RPC_URL,
    REGISTRY_RPC_URL,
    ENS_ADDRESS,
    REGISTRY_ADDRESS,
    ENS_CACHE_ADDRESS,
} = process.env

const lastArg = process.argv[process.argv.length - 1]
const streamName = lastArg.endsWith(".ts") ? STREAM_NAME : lastArg // ".ts" is this file, means no args given
if (!streamName) { throw new Error("Missing argument (or environment variable STREAM_NAME)") }
const streamPath = streamName.startsWith("/") ? streamName : "/" + streamName

if (!METADATA || !isJSON(METADATA)) {
    throw new Error("Please set METADATA environment variable to a valid JSON string")
}

const ensChainRpc = ENS_RPC_URL ?? (config as any)[ENS_CHAIN]?.rpcEndpoints?.[0]?.url
if (!ensChainRpc) { throw new Error("Either ENS_CHAIN or ENS_RPC_URL must be set in environment") }
const ensChainProvider = new JsonRpcProvider(ensChainRpc)

const registryChainRpc = REGISTRY_RPC_URL ?? (config as any)[REGISTRY_CHAIN]?.rpcEndpoints?.[0]?.url
if (!registryChainRpc) { throw new Error("Either REGISTRY_CHAIN or REGISTRY_RPC_URL must be set in environment") }
const registryChainProvider = new JsonRpcProvider(registryChainRpc)

const wallet = new Wallet(KEY, registryChainProvider)
log("Wallet address used by script: ", wallet.address)

const ensAddress = ENS_ADDRESS ?? (config as any)[ENS_CHAIN]?.contracts?.ENS
if (!ensAddress) { throw new Error("Either ENS_CHAIN or ENS_ADDRESS must be set in environment") }
const ensContract = new Contract(ensAddress, ensRegistryABI, ensChainProvider) as ENS

const registryAddress = REGISTRY_ADDRESS ?? (config as any)[REGISTRY_CHAIN]?.contracts?.StreamRegistry
if (!registryAddress) { throw new Error("Either REGISTRY_CHAIN or REGISTRY_ADDRESS must be set in environment") }
const streamRegistry = new Contract(registryAddress, streamRegistryABI, wallet) as StreamRegistry

const ensCacheAddress = ENS_CACHE_ADDRESS ?? (config as any)[REGISTRY_CHAIN]?.contracts?.ENSCacheV2
if (!ensCacheAddress) { throw new Error("Either REGISTRY_CHAIN or ENS_CACHE_ADDRESS must be set in environment") }
const ensCache = new Contract(ensCacheAddress, ENSCacheV2ABI, wallet) as ENSCacheV2

const AddressZero = "0x0000000000000000000000000000000000000000"
async function main() {
    log("Creating stream %s", streamName)
    let streamId = wallet.address.toLowerCase() + streamPath
    if (ENS_NAME) {
        const ensName = ENS_NAME.endsWith(".eth") ? ENS_NAME : ENS_NAME + ".eth"
        streamId = ensName + streamPath
        const myEnsNamehash = namehash(ensName)
        log("Check: querying owner of %s (%s)", ensName, myEnsNamehash)
        const ensNameOwner = await ensContract.owner(myEnsNamehash)
        log("    From ENS: %s", ensNameOwner)
        if (ensNameOwner !== wallet.address) {
            throw new Error(`ENS name ${ensName} is not owned by wallet ${wallet.address}!`)
        }

        const cachedOwner = await ensCache.owners(ensName)
        const wasCached = cachedOwner !== AddressZero
        log("    From ENSCache: %s", wasCached ? cachedOwner : "NOT CACHED")

        log("Creating stream, id = %s", streamId)
        log("    metadata = %s", METADATA)
        const tx = await streamRegistry.createStreamWithENS(ensName, streamPath!, METADATA!)
        log("Sending createStreamWithENS transaction: %o", tx)
        const receipt = await tx.wait()
        log("Receipt: %o", formatReceipt(receipt))

        const createEvents = receipt.events!.filter((e) => e.event === "StreamCreated")

        // if the ENS name was not cached, wait for ens-sync-script to fill the ENS cache and resume stream creation
        if (!wasCached) {
            if (createEvents.length > 0) {
                log("    Unexpected StreamCreated event(s): %o", createEvents)
            } else {
                log("Waiting for StreamCreated event")
                const event = await untilEvent(streamRegistry, "StreamCreated")
                log("    Got: %o", formatEvent(event))
            }
        } else {
            log("    StreamCreated event(s): %o", createEvents)
        }
    } else {
        log("Creating stream, id = %s", streamId)
        log("    metadata = %s", METADATA)
        const tx = await streamRegistry.createStream(streamPath!, METADATA!)
        log("Sending createStream transaction: %o", tx)
        const receipt = await tx.wait()
        log("Receipt: %o", formatReceipt(receipt))
    }

    log("Checking stream '%s'", streamId)
    log("    Owner's permissions: %o", formatPermissions(await streamRegistry.getPermissionsForUser(streamId, wallet.address)))
    log("    Metadata: %s", await streamRegistry.getStreamMetadata(streamId))
}

function isJSON(str: string) {
    try {
        JSON.parse(str)
        return true
    } catch (e) {
        return false
    }
}

function untilEvent(contract: Contract, eventName: string): Promise<Event> {
    return new Promise((resolve) => {
        const handler: Listener = (...args: any[]) => {
            const event = args.pop() as Event
            contract.removeListener(eventName, handler)
            resolve(event)
        }
        contract.on(eventName, handler)
    })
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
