// Steps before running this file:
//   start dev env: streamr-docker-dev start dev-chain-fast

import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"

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

const lastArgs = process.argv.slice(-2)
const noArgs = lastArgs.length < 2 || lastArgs[1].endsWith(".ts")
const setterName = noArgs ? SETTER : lastArgs[0]
const valueRaw = noArgs ? VALUE : lastArgs[1]
if (!setterName || !valueRaw) { throw new Error("Missing arguments (or environment variables SETTER, VALUE)") }

const rpcAddress = ETHEREUM_RPC ?? (config as any)[CHAIN]?.rpcEndpoints?.[0]?.url

const provider = new JsonRpcProvider(rpcAddress)
const wallet = new Wallet(KEY, provider)
log("Wallet address used transaction: ", wallet.address)

const streamrConfigAddress = STREAMR_CONFIG_ADDRESS ?? (config as any)[CHAIN]?.contracts?.StreamrConfig
if (!streamrConfigAddress) { throw new Error("Either CHAIN (with StreamrConfig address) or STREAMR_CONFIG_ADDRESS must be set in environment") }
const streamrConfig = new Contract(streamrConfigAddress, streamrConfigABI, wallet)

const setter = streamrConfig[setterName]
if (!setter || typeof setter !== "function") { throw new Error("No such setter in StreamrConfig: " + setterName) }

async function main() {
    log("Network %s: %o", CHAIN, await provider.getNetwork())
    log("Checking StreamrConfig at %s", streamrConfig.address)
    const codeLength = await provider.getCode(streamrConfig.address).then((code) => code.length)
    if (codeLength < 3) { throw new Error("No contract found at " + streamrConfig.address) }
    log("    %s [OK]", await streamrConfig.CONFIGURATOR_ROLE())

    if (setterName!.startsWith("set")) {
        const getterName = setterName![3].toLowerCase() + setterName!.slice(4)
        log("Current value of %s: %o", getterName, await streamrConfig[getterName]())
    }

    log("Setting %s to %s (from %s)", setterName, valueRaw, wallet.address)
    const tx = await setter(valueRaw)
    log("Transaction hash: %s", tx.hash)
    const tr = await tx.wait()
    log("Transaction receipt: %o", tr)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
