#!npx ts-node

// Before running this file, start dev env: streamr-docker-dev start dev-chain-fast
// Setter example: ./scripts/streamrConfig.ts setVotingPeriodSeconds 900
// Setter example: ./scripts/streamrConfig.ts setSlashingFraction 0.1
// Getter example: ./scripts/streamrConfig.ts minimumStakeWei

import { writeFileSync } from "fs"
import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { parseEther, formatEther } from "@ethersproject/units"

import { config } from "@streamr/config"

import { streamrConfigABI } from "@streamr/network-contracts"
import { formatReceipt } from "./prettyPrint"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    METHOD,
    VALUE,

    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    CHAIN = "dev2",
    ETHEREUM_RPC,

    STREAMR_CONFIG_ADDRESS,
    OUTPUT_FILE,
} = process.env

const {
    contracts: {
        StreamrConfig: streamrConfigAddressFromConfig,
    },
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]

const lastArgs = process.argv.slice(-2)
const noMethod = lastArgs.length < 2 || lastArgs[1].endsWith(".ts")
const noValue = lastArgs.length < 2 || lastArgs[0].endsWith(".ts")
const methodName = noMethod ? METHOD : lastArgs[noValue ? 1 : 0]
const valueRaw = noValue ? VALUE : lastArgs[1]
if (!methodName) { throw new Error("Missing arguments (or environment variable METHOD)") }
const methodIsSetter = methodName.startsWith("set")
if (methodIsSetter && !valueRaw) { throw new Error("Missing value for method (or environment variable VALUE)") }

const ethereumRpcUrl = ETHEREUM_RPC ?? ethereumRpcUrlFromConfig
const provider = new JsonRpcProvider(ethereumRpcUrl)
const wallet = new Wallet(KEY, provider)
log("Wallet address used: %s", wallet.address)

const streamrConfigAddress = STREAMR_CONFIG_ADDRESS ?? streamrConfigAddressFromConfig
if (!streamrConfigAddress) { throw new Error("Either CHAIN (with StreamrConfig address) or STREAMR_CONFIG_ADDRESS must be set in environment") }
const streamrConfig = new Contract(streamrConfigAddress, streamrConfigABI, wallet)

const method = streamrConfig[methodName]
// log("%s %o %o", typeof method, method, Object.keys(streamrConfig))
if (!method || typeof method !== "function") { throw new Error("No such method in StreamrConfig: " + methodName) }

async function main() {
    log("Checking network %s: %s", CHAIN, ethereumRpcUrl)
    log("    %s", JSON.stringify(await provider.getNetwork()))
    log("Checking StreamrConfig at %s", streamrConfig.address)
    const codeLength = await provider.getCode(streamrConfig.address).then((code) => code.length)
    if (codeLength < 3) { throw new Error("No contract found at " + streamrConfig.address) }
    log("    %s [OK]", await streamrConfig.CONFIGURATOR_ROLE())

    let valueIsTokens = false
    if (methodIsSetter) {
        const getterName = methodName![3].toLowerCase() + methodName!.slice(4)
        const oldValue = await streamrConfig[getterName]()
        valueIsTokens = oldValue.constructor.name === "BigNumber" && oldValue.gt(1e14)
        log("Current value of %s: %s", getterName, oldValue.toString() + (valueIsTokens ? " (" + formatEther(oldValue) + ")" : ""))

        const newValue = valueIsTokens && parseFloat(valueRaw!) < 1e10 ? parseEther(valueRaw!) : valueRaw

        log("Setting %s to %s (%s)", methodName, newValue, valueRaw)
        const tx = await method(newValue)
        log("Transaction: %s/tx/%s", blockExplorerUrl, tx.hash)
        const tr = await tx.wait()
        log("Transaction receipt: %o", formatReceipt(tr))

        if (OUTPUT_FILE) {
            writeFileSync(OUTPUT_FILE, oldValue.toString())
        }
    } else {
        const value = await method()
        valueIsTokens = value.constructor.name === "BigNumber" && value.gt(1e14)
        log("%s: %s", methodName, value.toString() + (valueIsTokens ? " (" + formatEther(value) + ")" : ""))
        if (OUTPUT_FILE) {
            writeFileSync(OUTPUT_FILE, value.toString())
        }
    }
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
