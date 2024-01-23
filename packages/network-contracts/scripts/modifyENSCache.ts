// Steps before running this file:
//   start dev env: streamr-docker-dev start dev-chain-fast

import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { getAddress } from "@ethersproject/address"
import { namehash } from "@ethersproject/hash"

import { config } from "@streamr/config"
import { ensRegistryABI, ENSCacheV2ABI } from "@streamr/network-contracts"
import type { ENS, ENSCacheV2 } from "@streamr/network-contracts"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",

    NAME = "streamr.eth",
    SYNC_SCRIPT_ADDRESS,

    // Easy chain setting: read addresses and URLs from @streamr/config
    ENS_CHAIN = "dev2",
    REGISTRY_CHAIN = "dev2",

    // Individual overrides
    ENS_RPC_URL,
    REGISTRY_RPC_URL,
    ENS_ADDRESS,
    ENS_CACHE_ADDRESS,
} = process.env

const lastArg = process.argv[process.argv.length - 1]
const ensNameRaw = lastArg.endsWith(".ts") ? NAME : lastArg // ".ts" is this file, means no args given
if (!ensNameRaw) { throw new Error("Missing argument (or environment variable NAME)") }
const ensName = ensNameRaw.endsWith(".eth") ? ensNameRaw : ensNameRaw + ".eth"

const ensChainRpc = ENS_RPC_URL ?? (config as any)[ENS_CHAIN]?.rpcEndpoints?.[0]?.url
if (!ensChainRpc) { throw new Error("Either ENS_CHAIN or ENS_RPC_URL must be set in environment") }
const ensChainProvider = new JsonRpcProvider(ensChainRpc)

const registryChainRpc = REGISTRY_RPC_URL ?? (config as any)[REGISTRY_CHAIN]?.rpcEndpoints?.[0]?.url
if (!registryChainRpc) { throw new Error("Either REGISTRY_CHAIN or REGISTRY_RPC_URL must be set in environment") }
const registryChainProvider = new JsonRpcProvider(registryChainRpc)
const registryChainWallet = new Wallet(KEY, registryChainProvider)
log("Wallet address used by script: ", registryChainWallet.address)

const ensAddress = ENS_ADDRESS ?? (config as any)[ENS_CHAIN]?.contracts?.ENS
if (!ensAddress) { throw new Error("Either ENS_CHAIN or ENS_ADDRESS must be set in environment") }
const ensContract = new Contract(ensAddress, ensRegistryABI, ensChainProvider) as unknown as ENS

const ensCacheAddress = ENS_CACHE_ADDRESS ?? (config as any)[REGISTRY_CHAIN]?.contracts?.ENSCacheV2
if (!ensCacheAddress) { throw new Error("Either REGISTRY_CHAIN or ENS_CACHE_ADDRESS must be set in environment") }
const ensCacheContract = new Contract(ensCacheAddress, ENSCacheV2ABI, registryChainWallet) as ENSCacheV2

const AddressZero = "0x0000000000000000000000000000000000000000"
const Bytes32Zero = "0x0000000000000000000000000000000000000000000000000000000000000000"
async function main() {
    log("Checking the network setup: %o", await ensChainProvider.getNetwork())
    log("    ENS contract at: %s (deployer %s)", ensContract.address, await ensContract.owner(Bytes32Zero))
    log("    ENSCacheV2 contract at: %s (%s)", ensCacheContract.address, await ensCacheContract.owners(AddressZero))

    if (SYNC_SCRIPT_ADDRESS) {
        log("Setting new ENS sync script address: %s", SYNC_SCRIPT_ADDRESS)
        const newAddress = getAddress(SYNC_SCRIPT_ADDRESS)
        const tx = await ensCacheContract.setStreamrScript(newAddress)
        log("Sending setStreamrScript transaction: %o", tx)
        const tr = await tx.wait()
        log("Receipt: %o", tr)
    }

    const myEnsNamehash = namehash(ensName)
    log("ENS check: querying owner of %s (%s)", ensName, myEnsNamehash)
    log("    Got: %s", await ensContract.owner(myEnsNamehash))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
