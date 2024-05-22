#!/usr/bin/env npx ts-node

import { writeFileSync } from "fs"
import { Contract, ContractFactory } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { formatEther, parseUnits } from "@ethersproject/units"

import { config } from "@streamr/config"
import { sponsorshipFactoryABI, voteKickPolicyABI, voteKickPolicyBytecode } from "@streamr/network-contracts"
import { formatReceipt } from "./prettyPrint"

import type { Overrides } from "@ethersproject/contracts"
import type { OperatorFactory } from "@streamr/network-contracts"

const { log } = console

const {
    CHAIN = "dev2",
    ETHEREUM_RPC,
    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    GAS_PRICE_GWEI,

    SPONSORSHIP_FACTORY_ADDRESS,

    // IGNORE_BALANCE,
    OUTPUT_FILE,
} = process.env
if (!CHAIN) {
    throw new Error("Must set CHAIN environment variable, e.g. CHAIN=dev2")
}
if (!KEY) {
    throw new Error("Must set KEY environment variable to current admin's key, e.g. KEY=0x...")
}

const {
    contracts: {
        SponsorshipFactory: sponsorshipFactoryAddressFromConfig,
    },
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]

const txOverrides: Overrides = {}
if (GAS_PRICE_GWEI) {
    txOverrides.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei")
}

// TODO: add to @streamr/config
// const blockExplorerUrl = (config as any)[CHAIN].blockExplorerUrl ?? ""

const ethereumRpcUrl = ETHEREUM_RPC ?? ethereumRpcUrlFromConfig
const provider = new JsonRpcProvider(ethereumRpcUrl)
const wallet = new Wallet(KEY, provider)
log("Wallet address used transaction: ", wallet.address)

const sponsorshipFactoryAddress = SPONSORSHIP_FACTORY_ADDRESS ?? sponsorshipFactoryAddressFromConfig
if (!sponsorshipFactoryAddress) { throw new Error("Either CHAIN (with SponsorshipFactory address) or SPONSORSHIP_FACTORY_ADDRESS must be set") }
const sponsorshipFactory = new Contract(sponsorshipFactoryAddress, sponsorshipFactoryABI, wallet) as OperatorFactory

async function main() {
    log("Checking network %s: %s", CHAIN, ethereumRpcUrl)
    log("    %o", await provider.getNetwork())

    // const gasRequired = 60000000 // measured in hardhat test network
    // const gasPrice = await provider.getGasPrice()
    // const estimatedGasCost = gasPrice.mul(gasRequired)
    // log("Estimated gas cost: %s ETH (gas price %s gwei)", formatEther(estimatedGasCost), formatUnits(gasPrice, "gwei"))

    const balanceBefore = await provider.getBalance(wallet.address)
    log("Balance of %s: %s ETH", wallet.address, formatEther(balanceBefore))
    // if (balanceBefore.lt(estimatedGasCost)) {
    //     if (!IGNORE_BALANCE) {
    //         throw new Error(
    //             `Insufficient native tokens for deployment in ${signer.address} (${formatEther(balanceBefore)} < ${formatEther(estimatedGasCost)})`
    //         )
    //     }
    // }
    const newVoteKickPolicy = await new ContractFactory(voteKickPolicyABI, voteKickPolicyBytecode, wallet).deploy(txOverrides)
    await newVoteKickPolicy.deployed()
    log("Deployed new vote kick policy at %s", newVoteKickPolicy.address)

    await sleep(1000)

    const whitelistTx = await sponsorshipFactory.addTrustedPolicy(newVoteKickPolicy.address, txOverrides)
    log("Whitelist policy tx: %s/tx/%s", blockExplorerUrl, whitelistTx.hash)
    const whitelistTxReceipt = await whitelistTx.wait()
    log("Tx receipt: %o", formatReceipt(whitelistTxReceipt))

    const balanceAfter = await provider.getBalance(wallet.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    if (OUTPUT_FILE) {
        writeFileSync(OUTPUT_FILE, newVoteKickPolicy.address)
    }
}

async function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

if (require.main === module) {
    main().catch(console.error)
}
