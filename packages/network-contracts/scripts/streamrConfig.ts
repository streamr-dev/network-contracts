#!npx ts-node

// Before running this file, start dev env: streamr-docker-dev start dev-chain-fast
// Usage example: ./scripts/streamrConfig.ts setVotingPeriodSeconds 900
// Usage example: ./scripts/streamrConfig.ts setSlashingFraction 0.1

import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { parseEther, formatEther } from "@ethersproject/units"

import { config } from "@streamr/config"

import { streamrConfigABI } from "@streamr/network-contracts"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    SETTER,
    VALUE,

    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    CHAIN = "dev2",
    ETHEREUM_RPC,

    STREAMR_CONFIG_ADDRESS,
} = process.env

const {
    contracts: {
        StreamrConfig: streamrConfigAddressFromConfig,
    },
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]

const lastArgs = process.argv.slice(-2)
const noArgs = lastArgs.length < 2 || lastArgs[1].endsWith(".ts")
const setterName = noArgs ? SETTER : lastArgs[0]
const valueRaw = noArgs ? VALUE : lastArgs[1]
if (!setterName || !valueRaw) { throw new Error("Missing arguments (or environment variables SETTER, VALUE)") }

const ethereumRpcUrl = ETHEREUM_RPC ?? ethereumRpcUrlFromConfig
const provider = new JsonRpcProvider(ethereumRpcUrl)
const wallet = new Wallet(KEY, provider)
log("Wallet address used transaction: ", wallet.address)

const streamrConfigAddress = STREAMR_CONFIG_ADDRESS ?? streamrConfigAddressFromConfig
if (!streamrConfigAddress) { throw new Error("Either CHAIN (with StreamrConfig address) or STREAMR_CONFIG_ADDRESS must be set in environment") }
const streamrConfig = new Contract(streamrConfigAddress, streamrConfigABI, wallet)

const setter = streamrConfig[setterName]
if (!setter || typeof setter !== "function") { throw new Error("No such setter in StreamrConfig: " + setterName) }

async function main() {
    log("Checking network %s: %s", CHAIN, ethereumRpcUrl)
    log("    %o", await provider.getNetwork())
    log("Checking StreamrConfig at %s", streamrConfig.address)
    const codeLength = await provider.getCode(streamrConfig.address).then((code) => code.length)
    if (codeLength < 3) { throw new Error("No contract found at " + streamrConfig.address) }
    log("    %s [OK]", await streamrConfig.CONFIGURATOR_ROLE())

    let valueIsTokens = false
    if (setterName!.startsWith("set")) {
        const getterName = setterName![3].toLowerCase() + setterName!.slice(4)
        const oldValue = await streamrConfig[getterName]()
        valueIsTokens = oldValue.constructor.name === "BigNumber" && oldValue.gt(1e14)
        log("Current value of %s: %s", getterName, oldValue.toString() + (valueIsTokens ? " (" + formatEther(oldValue) + ")" : ""))
    }

    const newValue = valueIsTokens && parseFloat(valueRaw!) < 1e10 ? parseEther(valueRaw!) : valueRaw

    log("Setting %s to %s (%s)", setterName, newValue, valueRaw)
    const tx = await setter(newValue)
    log("Transaction: %s/tx/%s", blockExplorerUrl, tx.hash)
    const tr = await tx.wait()
    log("Transaction receipt: %o", tr)
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
