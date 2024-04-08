#!/usr/bin/env npx ts-node

// Before running this file, start dev env: streamr-docker-dev start dev-chain-fast
// Example: scripts/delegate.ts 123 0x1234567890123456789012345678901234567890

// import { writeFileSync } from "fs"
import { Contract, Overrides } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { parseEther, formatEther, parseUnits } from "@ethersproject/units"
import { isAddress } from "@ethersproject/address"
import { BigNumber } from "@ethersproject/bignumber"

import { config } from "@streamr/config"

import { ERC677ABI, operatorABI } from "@streamr/network-contracts"
import { formatReceipt } from "./prettyPrint"

import type { ERC677, Operator } from "@streamr/network-contracts"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    OPERATOR = "",
    AMOUNT = "",
    GIFT_TO_OWNER = "", // send as self-delegation; if self-delegation is low, this is the only way to send in tokens

    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    CHAIN = "dev2",
    ETHEREUM_RPC,
    GAS_PRICE_GWEI,

    TOKEN_ADDRESS,
    // OUTPUT_FILE,
} = process.env

const {
    contracts: {
        DATA: tokenAddressFromConfig,
    },
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]

const lastArgs = process.argv.slice(-2)
const noAmount = lastArgs.length < 2 || lastArgs[1].endsWith(".ts")
const noAddress = lastArgs.length < 2 || lastArgs[0].endsWith(".ts")
const amountRaw = noAmount ? AMOUNT : lastArgs[noAddress ? 1 : 0]
const operatorAddress = noAddress ? OPERATOR : lastArgs[1]
if (isNaN(parseInt(amountRaw))) {
    throw new Error(`Bad amount "${amountRaw}" (or environment variable AMOUNT)`)
}
if (!isAddress(operatorAddress)) {
    log("Delegation target contract address can be given as command-line argument, or as OPERATOR environment variable.")
    throw new Error(`Bad Operator contract address "${operatorAddress}" (or environment variable OPERATOR)`)
}
const amountBN = BigNumber.from(amountRaw)
const amountWei = amountBN.lt(1e13) ? parseEther(amountRaw) : amountBN

const ethereumRpcUrl = ETHEREUM_RPC ?? ethereumRpcUrlFromConfig
const provider = new JsonRpcProvider(ethereumRpcUrl)
const wallet = new Wallet(KEY, provider)
log("Wallet address used: %s", wallet.address)

const txOverrides: Overrides = {}
if (GAS_PRICE_GWEI) {
    txOverrides.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei")
}

const tokenAddress = TOKEN_ADDRESS ?? tokenAddressFromConfig
if (!tokenAddress) { throw new Error("Either CHAIN (with DATA address) or TOKEN_ADDRESS must be set in environment") }
const token = new Contract(tokenAddress, ERC677ABI, wallet) as ERC677
const operator = new Contract(operatorAddress, operatorABI, wallet) as Operator

async function main() {
    log("Checking network %s: %s", CHAIN, ethereumRpcUrl)
    log("    %s", JSON.stringify(await provider.getNetwork()))
    log("Checking token at %s", token.address)
    log("    totalSupply: %s", await token.totalSupply())
    log("Checking Operator at %s", operator.address)
    const codeLength = await provider.getCode(operator.address).then((code) => code.length)
    if (codeLength < 3) { throw new Error("No contract found at " + operator.address) }
    const ownerAddress = await operator.owner()
    log("    Owner: %s", ownerAddress)
    log("    Balance: %s DATA", formatEther(await token.balanceOf(operator.address)))
    log("    Value: %s DATA", formatEther(await operator.valueWithoutEarnings()))

    log("Delegating %s DATA into %s", formatEther(amountWei), operator.address)
    let target = "0x"
    if (GIFT_TO_OWNER) {
        log("Sending as self-delegation to owner (gifting tokens!) %s", ownerAddress)
        target = ownerAddress
    }
    const tx = await token.transferAndCall(operator.address, amountWei, target, txOverrides)
    log("Transaction: %s/tx/%s", blockExplorerUrl, tx.hash)
    const tr = await tx.wait()
    log("Transaction receipt: %o", formatReceipt(tr))

    log("Operator status after delegation:")
    log("    Balance: %s DATA", formatEther(await token.balanceOf(operator.address)))
    log("    Value: %s DATA", formatEther(await operator.valueWithoutEarnings()))
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
