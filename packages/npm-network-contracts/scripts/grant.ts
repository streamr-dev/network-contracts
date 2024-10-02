// Steps before running this file:
//   start dev env: streamr-docker-dev start dev-chain-fast

import {
    Contract, Wallet, JsonRpcProvider,
    parseEther, formatEther, parseUnits, isAddress,
} from "ethers"

import { config } from "@streamr/config"
import { streamRegistryABI, ENSCacheV2ABI } from "@streamr/network-contracts"
import type { StreamRegistry, ENSCacheV2 } from "@streamr/network-contracts"

import { formatPermissions } from "./prettyPrint"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    STREAM,
    USER,
    TX,

    // Easy setting: read addresses and URLs from @streamr/config
    CHAIN = "dev2",
    // ENS_CHAIN = "dev2",

    // Individual overrides
    // ENS_RPC_URL,
    REGISTRY_RPC_URL,
    // ENS_ADDRESS,
    REGISTRY_ADDRESS,
    ENS_CACHE_ADDRESS,

    // ENS_REGISTRAR_ADDRESS,
    // ENS_RESOLVER_ADDRESS,
} = process.env

// const ensChainRpc = ENS_RPC_URL ?? (config as any)[ENS_CHAIN]?.rpcEndpoints?.[0]?.url
// if (!ensChainRpc) { throw new Error("Either ENS_CHAIN or ENS_RPC_URL must be set in environment") }
// const ensChainProvider = new JsonRpcProvider(ensChainRpc)

const registryChainRpcUrl = REGISTRY_RPC_URL ?? (config as any)[CHAIN]?.rpcEndpoints?.[0]?.url
if (!registryChainRpcUrl) { throw new Error("Either REGISTRY_CHAIN or REGISTRY_RPC_URL must be set in environment") }
const provider = new JsonRpcProvider(registryChainRpcUrl)
// const registryChainWallet = new Wallet(KEY, registryChainProvider)
// log("Wallet address used by script: ", registryChainWallet.address)

// const ensAddress = ENS_ADDRESS ?? (config as any)[ENS_CHAIN]?.contracts?.ENS
// if (!ensAddress) { throw new Error("Either ENS_CHAIN or ENS_ADDRESS must be set in environment") }
// const ensContract = new Contract(ensAddress, ensRegistryABI, ensChainProvider) as unknown as ENS

const registryAddress = REGISTRY_ADDRESS ?? (config as any)[CHAIN]?.contracts?.StreamRegistry
if (!registryAddress) { throw new Error("Either REGISTRY_CHAIN or REGISTRY_ADDRESS must be set in environment") }
const streamRegistry = new Contract(registryAddress, streamRegistryABI, provider) as StreamRegistry

const ensCacheAddress = ENS_CACHE_ADDRESS ?? (config as any)[CHAIN]?.contracts?.ENSCacheV2
if (!ensCacheAddress) { throw new Error("Either REGISTRY_CHAIN or ENS_CACHE_ADDRESS must be set in environment") }
const ensCacheContract = new Contract(ensCacheAddress, ENSCacheV2ABI, provider) as ENSCacheV2

// const ensResolverAddress = ENS_RESOLVER_ADDRESS ?? (config as any)[ENS_CHAIN]?.contracts?.PublicResolver
// if (!ensResolverAddress) { throw new Error("Either CHAIN (with PublicResolver address) or ENS_RESOLVER_ADDRESS must be set in environment") }

const AddressZero = "0x0000000000000000000000000000000000000000"
// const Bytes32Zero = "0x0000000000000000000000000000000000000000000000000000000000000000"
const TRUSTED_ROLE = "0x2de84d9fbdf6d06e2cc584295043dbd76046423b9f8bae9426d4fa5e7c03f4a7"
async function main() {
    log("Checking ENS (cache/bridge) state")
    log("Checking the network setup: %o", await provider.getNetwork())
    // log("ENS contract at: %s (deployer %s)", ensContract.address, await ensContract.owner(Bytes32Zero))
    log("StreamRegistry contract at: %s (%s)", streamRegistry.address, TRUSTED_ROLE == await streamRegistry.TRUSTED_ROLE())
    log("ENSCacheV2 contract at: %s (%s)", ensCacheContract.address, await ensCacheContract.owners(AddressZero))

    if (STREAM) {
        log("Checking stream '%s'", STREAM)
        log("  Metadata: %s", await streamRegistry.getStreamMetadata(STREAM))
        if (USER) {
            // pad to 32 bytes, TODO: below lines should Just Work in the same way (ETH-777)
            const userIdBytes = hexZeroPad(USER, 32)
            log("User ID bytes: %s", userIdBytes)
            log("  %s permissions: %o", USER, await streamRegistry.getPermissionsForUser(STREAM, USER).then(formatPermissions))
            log("  %s permissions: %o", USER, await streamRegistry.getPermissionsForUserId(STREAM, userIdBytes)
                .then(formatPermissions).catch(() => "error")
            )
        }
    }

    if (TX) {
        log("Checking transaction %s", TX)
        log("  Receipt: %o", await provider.getTransactionReceipt(TX))
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
