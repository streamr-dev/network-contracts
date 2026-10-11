#!/usr/bin/env npx ts-node

/**
 * Deploy a new Sponsorship template contract (the clone target used by SponsorshipFactory).
 *
 * This script does NOT call SponsorshipFactory.updateTemplate: that is done separately by the ADMIN_ROLE holder (multisig).
 * The calldata for that transaction is printed at the end for convenience.
 *
 * Environment variables:
 *   CHAIN           network name from @streamr/config, e.g. polygon (default: dev2)
 *   KEY             deployer private key (does NOT need to be the factory admin)
 *   ETHEREUM_RPC    optional, overrides the RPC endpoint from @streamr/config
 *   GAS_PRICE_GWEI  optional, legacy gas price override (otherwise provider.getGasPrice() is used)
 *   OUTPUT_FILE     optional, the deployed address is written here (used by the follow-up verification step)
 */

import { writeFileSync } from "fs"
import { Contract, ContractFactory } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { formatEther, formatUnits, parseUnits } from "@ethersproject/units"

import { config } from "@streamr/config"
import { sponsorshipABI, sponsorshipBytecode, sponsorshipFactoryABI } from "@streamr/network-contracts"
import { formatReceipt } from "./prettyPrint"

import type { Overrides } from "@ethersproject/contracts"
import type { Sponsorship } from "@streamr/network-contracts"

const { log } = console

const {
    CHAIN = "dev2",
    ETHEREUM_RPC,
    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    GAS_PRICE_GWEI,
    OUTPUT_FILE,
} = process.env
if (!CHAIN) {
    throw new Error("Must set CHAIN environment variable, e.g. CHAIN=dev2")
}
if (!KEY) {
    throw new Error("Must set KEY environment variable to the deployer's key, e.g. KEY=0x...")
}

const {
    contracts: {
        SponsorshipFactory: sponsorshipFactoryAddress,
    },
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]

const ethereumRpcUrl = ETHEREUM_RPC ?? ethereumRpcUrlFromConfig
const provider = new JsonRpcProvider(ethereumRpcUrl)
const wallet = new Wallet(KEY, provider)
log("Wallet address used for deployment: ", wallet.address)

async function main() {
    log("Checking network %s: %s", CHAIN, ethereumRpcUrl)
    log("    %o", await provider.getNetwork())

    // ethers v5 getFeeData() hardcodes maxPriorityFeePerGas to 1.5 gwei, which is below Polygon's minimum tip,
    //   so use a legacy gasPrice transaction instead
    const txOverrides: Overrides = {
        gasPrice: GAS_PRICE_GWEI ? parseUnits(GAS_PRICE_GWEI, "gwei") : await provider.getGasPrice(),
    }
    log("Gas price: %s gwei", formatUnits(txOverrides.gasPrice as any, "gwei"))

    const balanceBefore = await provider.getBalance(wallet.address)
    log("Balance of %s: %s ETH", wallet.address, formatEther(balanceBefore))

    if (sponsorshipFactoryAddress) {
        const sponsorshipFactory = new Contract(sponsorshipFactoryAddress, sponsorshipFactoryABI, provider)
        const currentTemplate = await sponsorshipFactory.sponsorshipContractTemplate().catch((e: Error) => `(could not read: ${e.message})`)
        log("Current Sponsorship template in factory %s: %s", sponsorshipFactoryAddress, currentTemplate)
    } else {
        log("No SponsorshipFactory address in @streamr/config for %s", CHAIN)
    }

    const sponsorshipTemplate = await (new ContractFactory(sponsorshipABI, sponsorshipBytecode, wallet)).deploy(txOverrides) as Sponsorship
    log("Deploy tx: %s/tx/%s", blockExplorerUrl, sponsorshipTemplate.deployTransaction.hash)
    const deployReceipt = await sponsorshipTemplate.deployed().then(() => sponsorshipTemplate.deployTransaction.wait())
    log("Deploy receipt: %o", formatReceipt(deployReceipt))
    await sleep(1000)
    await checkAddressHasContract(sponsorshipTemplate.address)
    log("Deployed Sponsorship template at %s", sponsorshipTemplate.address)
    log("    %s/address/%s", blockExplorerUrl, sponsorshipTemplate.address)

    const balanceAfter = await provider.getBalance(wallet.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    if (sponsorshipFactoryAddress) {
        const sponsorshipFactory = new Contract(sponsorshipFactoryAddress, sponsorshipFactoryABI, provider)
        const calldata = sponsorshipFactory.interface.encodeFunctionData("updateTemplate", [sponsorshipTemplate.address])
        log("")
        log("To take the new template into use, the ADMIN_ROLE holder must send:")
        log("    to:   %s (SponsorshipFactory)", sponsorshipFactoryAddress)
        log("    data: %s", calldata)
        log("    i.e. SponsorshipFactory.updateTemplate(%s)", sponsorshipTemplate.address)
    }

    if (OUTPUT_FILE) {
        writeFileSync(OUTPUT_FILE, sponsorshipTemplate.address)
        log("Wrote address to %s", OUTPUT_FILE)
    }
}

async function checkAddressHasContract(address: string) {
    const code = await provider.getCode(address)
    if (code === "0x") {
        throw new Error(`No contract at address ${address}`)
    }
    log("OK (%s)", code.slice(0, 20))
}

async function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e)
        process.exit(1)
    })
}
