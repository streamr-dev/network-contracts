// Steps before running this file:
//   start dev env: streamr-docker-dev start dev-chain-fast

import { Contract } from "@ethersproject/contracts"
import { JsonRpcProvider } from "@ethersproject/providers"

import { config } from "@streamr/config"
import { streamRegistryABI, ensRegistryABI, ENSCacheV2ABI } from "@streamr/network-contracts"
import type { ENS, StreamRegistry, ENSCacheV2 } from "@streamr/network-contracts"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    STREAM_ID,
    TX,

    // Easy setting: read addresses and URLs from @streamr/config
    ENS_CHAIN = "dev2",
    REGISTRY_CHAIN = "dev2",

    // Individual overrides
    ENS_RPC_URL,
    REGISTRY_RPC_URL,
    ENS_ADDRESS,
    REGISTRY_ADDRESS,
    ENS_CACHE_ADDRESS,

    // ENS_REGISTRAR_ADDRESS,
    ENS_RESOLVER_ADDRESS,
} = process.env

const ensChainRpc = ENS_RPC_URL ?? (config as any)[ENS_CHAIN]?.rpcEndpoints?.[0]?.url
if (!ensChainRpc) { throw new Error("Either ENS_CHAIN or ENS_RPC_URL must be set in environment") }
const ensChainProvider = new JsonRpcProvider(ensChainRpc)

const registryChainRpc = REGISTRY_RPC_URL ?? (config as any)[REGISTRY_CHAIN]?.rpcEndpoints?.[0]?.url
if (!registryChainRpc) { throw new Error("Either REGISTRY_CHAIN or REGISTRY_RPC_URL must be set in environment") }
const registryChainProvider = new JsonRpcProvider(registryChainRpc)
// const registryChainWallet = new Wallet(KEY, registryChainProvider)
// log("Wallet address used by script: ", registryChainWallet.address)

const ensAddress = ENS_ADDRESS ?? (config as any)[ENS_CHAIN]?.contracts?.ENS
if (!ensAddress) { throw new Error("Either ENS_CHAIN or ENS_ADDRESS must be set in environment") }
const ensContract = new Contract(ensAddress, ensRegistryABI, ensChainProvider) as unknown as ENS

const registryAddress = REGISTRY_ADDRESS ?? (config as any)[REGISTRY_CHAIN]?.contracts?.StreamRegistry
if (!registryAddress) { throw new Error("Either REGISTRY_CHAIN or REGISTRY_ADDRESS must be set in environment") }
const streamRegistryContract = new Contract(registryAddress, streamRegistryABI, registryChainProvider) as StreamRegistry

const ensCacheAddress = ENS_CACHE_ADDRESS ?? (config as any)[REGISTRY_CHAIN]?.contracts?.ENSCacheV2
if (!ensCacheAddress) { throw new Error("Either REGISTRY_CHAIN or ENS_CACHE_ADDRESS must be set in environment") }
const ensCacheContract = new Contract(ensCacheAddress, ENSCacheV2ABI, registryChainProvider) as ENSCacheV2

const ensResolverAddress = ENS_RESOLVER_ADDRESS ?? (config as any)[ENS_CHAIN]?.contracts?.PublicResolver
if (!ensResolverAddress) { throw new Error("Either CHAIN (with PublicResolver address) or ENS_RESOLVER_ADDRESS must be set in environment") }

const AddressZero = "0x0000000000000000000000000000000000000000"
const Bytes32Zero = "0x0000000000000000000000000000000000000000000000000000000000000000"
async function main() {
    log("Checking ENS (cache/bridge) state")
    log("Checking the network setup: %o", await ensChainProvider.getNetwork())
    log("ENS contract at: %s (deployer %s)", ensContract.address, await ensContract.owner(Bytes32Zero))
    log("StreamRegistry contract at: %s (%s)", streamRegistryContract.address, await streamRegistryContract.TRUSTED_ROLE())
    log("ENSCacheV2 contract at: %s (%s)", ensCacheContract.address, await ensCacheContract.owners(AddressZero))

    if (STREAM_ID) {
        log("Checking stream '%s'", STREAM_ID)
        log("  Metadata: %s", await streamRegistryContract.getStreamMetadata(STREAM_ID))
    }

    if (TX) {
        log("Checking transaction %s", TX)
        log("  Receipt: %o", await ensChainProvider.getTransactionReceipt(TX))
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
