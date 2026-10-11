#!/usr/bin/env npx ts-node

/**
 * Deploy a new Operator template contract and its delegatecall modules (NodeModule, QueueModule, StakeModule),
 *   i.e. the clone targets used by OperatorFactory.
 *
 * This script does NOT call OperatorFactory.updateTemplates: that is done separately by the ADMIN_ROLE holder (multisig).
 * The calldata for that transaction is printed at the end for convenience.
 *
 * Environment variables:
 *   CHAIN           network name from @streamr/config, e.g. polygon (default: dev2)
 *   KEY             deployer private key (does NOT need to be the factory admin)
 *   ETHEREUM_RPC    optional, overrides the RPC endpoint from @streamr/config
 *   GAS_PRICE_GWEI  optional, legacy gas price override (otherwise provider.getGasPrice() is used)
 *   OUTPUT_FILE     optional, the deployed addresses are written to operatorTemplate-$OUTPUT_FILE, nodeModule-$OUTPUT_FILE,
 *                     queueModule-$OUTPUT_FILE and stakeModule-$OUTPUT_FILE (used by the follow-up verification step)
 */

import { writeFileSync } from "fs"
import { basename, dirname, join } from "path"
import { Contract, ContractFactory } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { formatEther, formatUnits, parseUnits } from "@ethersproject/units"

import { config } from "@streamr/config"
import {
    operatorFactoryABI,
    operatorABI, operatorBytecode,
    nodeModuleABI, nodeModuleBytecode,
    queueModuleABI, queueModuleBytecode,
    stakeModuleABI, stakeModuleBytecode,
} from "@streamr/network-contracts"
import { formatReceipt } from "./prettyPrint"

import type { Overrides } from "@ethersproject/contracts"

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
        OperatorFactory: operatorFactoryAddress,
    },
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]

const ethereumRpcUrl = ETHEREUM_RPC ?? ethereumRpcUrlFromConfig
const provider = new JsonRpcProvider(ethereumRpcUrl)
const wallet = new Wallet(KEY, provider)
log("Wallet address used for deployment: ", wallet.address)

const txOverrides: Overrides = {}

async function deploy(name: string, abi: any, bytecode: string): Promise<Contract> {
    const contract = await (new ContractFactory(abi, bytecode, wallet)).deploy(txOverrides)
    log("%s deploy tx: %s/tx/%s", name, blockExplorerUrl, contract.deployTransaction.hash)
    const receipt = await contract.deployed().then(() => contract.deployTransaction.wait())
    log("%s deploy receipt: %o", name, formatReceipt(receipt))
    await sleep(1000)
    const code = await provider.getCode(contract.address)
    if (code === "0x") {
        throw new Error(`No contract at address ${contract.address}`)
    }
    log("Deployed %s at %s (code %s...)", name, contract.address, code.slice(0, 20))
    log("    %s/address/%s", blockExplorerUrl, contract.address)
    return contract
}

async function main() {
    log("Checking network %s: %s", CHAIN, ethereumRpcUrl)
    log("    %o", await provider.getNetwork())

    // ethers v5 getFeeData() hardcodes maxPriorityFeePerGas to 1.5 gwei, which is below Polygon's minimum tip,
    //   so use a legacy gasPrice transaction instead
    txOverrides.gasPrice = GAS_PRICE_GWEI ? parseUnits(GAS_PRICE_GWEI, "gwei") : await provider.getGasPrice()
    log("Gas price: %s gwei", formatUnits(txOverrides.gasPrice as any, "gwei"))

    const balanceBefore = await provider.getBalance(wallet.address)
    log("Balance of %s: %s ETH", wallet.address, formatEther(balanceBefore))

    const operatorFactory = operatorFactoryAddress ? new Contract(operatorFactoryAddress, operatorFactoryABI, provider) : null
    if (operatorFactory) {
        const read = (fn: string) => operatorFactory[fn]().catch((e: Error) => `(could not read: ${e.message.split("[")[0].trim()})`)
        log("Current templates in OperatorFactory %s:", operatorFactoryAddress)
        log("    operatorTemplate:    %s", await read("operatorTemplate"))
        log("    nodeModuleTemplate:  %s", await read("nodeModuleTemplate"))
        log("    queueModuleTemplate: %s", await read("queueModuleTemplate"))
        log("    stakeModuleTemplate: %s", await read("stakeModuleTemplate"))
    } else {
        log("No OperatorFactory address in @streamr/config for %s", CHAIN)
    }

    const operatorTemplate = await deploy("Operator template", operatorABI, operatorBytecode)
    const nodeModule = await deploy("NodeModule", nodeModuleABI, nodeModuleBytecode)
    const queueModule = await deploy("QueueModule", queueModuleABI, queueModuleBytecode)
    const stakeModule = await deploy("StakeModule", stakeModuleABI, stakeModuleBytecode)

    const balanceAfter = await provider.getBalance(wallet.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    log("")
    log("New Operator template: %s", operatorTemplate.address)
    log("New NodeModule:        %s", nodeModule.address)
    log("New QueueModule:       %s", queueModule.address)
    log("New StakeModule:       %s", stakeModule.address)

    if (operatorFactory) {
        const args = [operatorTemplate.address, nodeModule.address, queueModule.address, stakeModule.address]
        const calldata = operatorFactory.interface.encodeFunctionData("updateTemplates", args)
        log("")
        log("To take the new templates into use, the ADMIN_ROLE holder must send:")
        log("    to:   %s (OperatorFactory)", operatorFactoryAddress)
        log("    data: %s", calldata)
        log("    i.e. OperatorFactory.updateTemplates(%s)", args.join(", "))
    }

    if (OUTPUT_FILE) {
        const outputFile = (prefix: string) => join(dirname(OUTPUT_FILE), `${prefix}-${basename(OUTPUT_FILE)}`)
        writeFileSync(outputFile("operatorTemplate"), operatorTemplate.address)
        writeFileSync(outputFile("nodeModule"), nodeModule.address)
        writeFileSync(outputFile("queueModule"), queueModule.address)
        writeFileSync(outputFile("stakeModule"), stakeModule.address)
        log("Wrote addresses to %s", outputFile("{operatorTemplate,nodeModule,queueModule,stakeModule}"))
    }
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
