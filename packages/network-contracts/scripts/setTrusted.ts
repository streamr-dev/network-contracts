#!npx ts-node

import { utils, Contract, providers, Wallet, Overrides } from "ethers"
import { config } from "@streamr/config"

import { streamRegistryABI } from "@streamr/network-contracts"
import type { StreamRegistry } from "@streamr/network-contracts"

const { log } = console

const { isAddress, getAddress, parseUnits } = utils
const { JsonRpcProvider } = providers

const {
    CHAIN,
    KEY = "",
    GAS_PRICE_GWEI,

    TARGET = "",
} = process.env

if (!CHAIN) {
    throw new Error("Must set CHAIN environment variable, e.g. CHAIN=dev2")
}
if (!KEY) {
    throw new Error("Must set KEY environment variable to current admin's key, e.g. KEY=0x...")
}

const {
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
    },
    rpcEndpoints: [{ url: ETHEREUM_RPC_URL }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]

const txOverrides: Overrides = {}
if (GAS_PRICE_GWEI) {
    txOverrides.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei")
}

const lastArg = process.argv[process.argv.length - 1]
const targetAddress = isAddress(lastArg) ? getAddress(lastArg) : isAddress(TARGET) ? getAddress(TARGET) : null
if (targetAddress === null) {
    log("Target address can be given as command-line argument, or as TARGET environment variable.")
    throw new Error("Must give target address!")
}

async function main() {
    const provider = new JsonRpcProvider(ETHEREUM_RPC_URL)
    const currentAdmin = new Wallet(KEY, provider)
    await setTrusted(currentAdmin, targetAddress!)
}

async function setTrusted(currentAdminWallet: Wallet, targetAddress: string) {
    if (!STREAM_REGISTRY_ADDRESS) {
        throw new Error(`StreamRegistry must be set in the config! Not found in chain "${CHAIN}".
            Check CHAIN environment variable, or deploy StreamRegistry first.`)
    }
    const streamRegistry = new Contract(STREAM_REGISTRY_ADDRESS, streamRegistryABI, currentAdminWallet) as StreamRegistry
    if (!await streamRegistry.hasRole(await streamRegistry.DEFAULT_ADMIN_ROLE(), currentAdminWallet.address)) {
        throw new Error(`${currentAdminWallet.address} doesn't have StreamRegistry.DEFAULT_ADMIN_ROLE`)
    }
    log("Found StreamRegistry at %s", streamRegistry.address)

    const tr0 = await (await streamRegistry.grantRole(await streamRegistry.TRUSTED_ROLE(), targetAddress, txOverrides)).wait()
    log("Granted StreamRegistry.TRUSTED_ROLE to %s (%s/tx/%s )", targetAddress, blockExplorerUrl, tr0.transactionHash)
}

if (require.main === module) {
    main().catch(console.error)
}
