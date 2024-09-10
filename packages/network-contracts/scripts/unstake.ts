#!/usr/bin/env npx ts-node

// Example: KEY=0x123... scripts/unstake.ts 0x1234567890123456789012345678901234567890

// import { writeFileSync } from "fs"
import { Contract, Overrides } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { formatEther, parseUnits } from "@ethersproject/units"
import { isAddress } from "@ethersproject/address"

import { config } from "@streamr/config"

import { ERC677ABI, operatorABI, operatorFactoryABI } from "@streamr/network-contracts"
// import { formatReceipt } from "./prettyPrint"

import type { ERC677, Operator } from "@streamr/network-contracts"
import { OperatorFactory } from "../typechain"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    SPONSORSHIP = "",

    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    CHAIN = "dev2",
    ETHEREUM_RPC,
    GAS_PRICE_GWEI,

    TOKEN_ADDRESS,
    OPERATOR_FACTORY_ADDRESS,
    // OUTPUT_FILE,
} = process.env

const {
    contracts: {
        DATA: tokenAddressFromConfig,
        OperatorFactory: operatorFactoryAddressFromConfig,
    },
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }]
} = (config as any)[CHAIN]

const lastArg = process.argv[process.argv.length - 1]
const sponsorshipAddress = lastArg.endsWith(".ts") ? SPONSORSHIP : lastArg // ".ts" is this file, means no args given
if (!isAddress(sponsorshipAddress)) {
    throw new Error(`Bad sponsorship contract address "${sponsorshipAddress}" (or last argument)`)
}

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

const operatorFactoryAddress = OPERATOR_FACTORY_ADDRESS ?? operatorFactoryAddressFromConfig
if (!operatorFactoryAddress) { throw new Error("Either CHAIN (with OperatorFactory address) or OPERATOR_FACTORY_ADDRESS must be set in environment") }
const operatorFactory = new Contract(operatorFactoryAddress, operatorFactoryABI, wallet) as OperatorFactory

async function main() {
    log("Checking network %s: %s", CHAIN, ethereumRpcUrl)
    log("    %s", JSON.stringify(await provider.getNetwork()))
    log("Checking token at %s", token.address)
    log("    totalSupply: %s", await token.totalSupply())

    log("Checking OperatorFactory at %s", operatorFactory.address)
    log("    Voter count: %s", JSON.stringify(await operatorFactory.voterCount()))
    const operatorAddress = await operatorFactory.operators(wallet.address)
    if (!isAddress(operatorAddress)) { throw new Error("No operator found for " + wallet.address) }
    log("Found Operator contract: %s", operatorAddress)
    const operator = new Contract(operatorAddress, operatorABI, wallet) as Operator

    log("Checking Operator %s in Sponsorship %s", operator.address, sponsorshipAddress)
    const codeLength = await provider.getCode(operator.address).then((code) => code.length)
    if (codeLength < 3) { throw new Error("No contract found at " + operator.address) }
    const ownerAddress = await operator.owner()
    log("    Owner: %s", ownerAddress)
    log("    Balance: %s DATA", formatEther(await token.balanceOf(operator.address)))
    log("    Value: %s DATA", formatEther(await operator.valueWithoutEarnings()))
    log("    Staked: %s DATA", formatEther(await operator.stakedInto(sponsorshipAddress)))

    log("Unstaking %s from %s", operator.address, sponsorshipAddress)
    const tx = await operator.unstake(sponsorshipAddress, txOverrides)
    log("Transaction: %s", tx.hash)

    log("Operator status after unstaking:")
    log("    Balance: %s DATA", formatEther(await token.balanceOf(operator.address)))
    log("    Value: %s DATA", formatEther(await operator.valueWithoutEarnings()))

    log("Voter count after unstaking: %s", JSON.stringify(await operatorFactory.voterCount()))
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
