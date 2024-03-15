#!/usr/bin/env npx ts-node

import { writeFileSync } from "fs"
import { Contract, ContractFactory } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { formatEther, parseUnits } from "@ethersproject/units"

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
import type { OperatorFactory } from "@streamr/network-contracts"

const { log } = console

const {
    CHAIN = "dev2",
    ETHEREUM_RPC,
    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    GAS_PRICE_GWEI,

    OPERATOR_FACTORY_ADDRESS,

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
        OperatorFactory: operatorFactoryAddressFromConfig,
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

const operatorFactoryAddress = OPERATOR_FACTORY_ADDRESS ?? operatorFactoryAddressFromConfig
if (!operatorFactoryAddress) { throw new Error("Either CHAIN (with OperatorFactory address) or OPERATOR_FACTORY_ADDRESS must be set in environment") }
const operatorFactory = new Contract(operatorFactoryAddress, operatorFactoryABI, wallet) as OperatorFactory

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
    // old mumbai operator template, for rollbacks:
    // const operatorTemplate = new Contract("0xbf4a0c165abcdc81ca7ffa222361e5ae891249c5", operatorABI, wallet)
    // old polygon operator template, for rollbacks:
    // const operatorTemplate = new Contract("0x0723Ef021BF630868764b3EC0fd210173ea0a5ef", operatorABI, wallet)

    const operatorTemplate = await (new ContractFactory(operatorABI, operatorBytecode, wallet)).deploy(txOverrides)
    await operatorTemplate.deployed()
    await sleep(1000)
    await checkAddressHasContract(operatorTemplate.address)
    log("Deployed Operator template at %s", operatorTemplate.address)
    await sleep(1000)

    // const nodeModuleAddress = await operatorFactory.nodeModuleTemplate()
    // const queueModuleAddress = await operatorFactory.queueModuleTemplate()
    // const stakeModuleAddress = await operatorFactory.stakeModuleTemplate()
    const nodeModule = await (new ContractFactory(nodeModuleABI, nodeModuleBytecode, wallet)).deploy(txOverrides)
    await nodeModule.deployed()
    await sleep(1000)
    await checkAddressHasContract(nodeModule.address)
    log("Deployed Node module at %s", nodeModule.address)

    const queueModule = await (new ContractFactory(queueModuleABI, queueModuleBytecode, wallet)).deploy(txOverrides)
    await queueModule.deployed()
    await sleep(1000)
    await checkAddressHasContract(queueModule.address)
    log("Deployed Queue module at %s", queueModule.address)

    const stakeModule = await (new ContractFactory(stakeModuleABI, stakeModuleBytecode, wallet)).deploy(txOverrides)
    await stakeModule.deployed()
    await sleep(1000)
    await checkAddressHasContract(stakeModule.address)
    log("Deployed Stake module at %s", stakeModule.address)

    log("Setting template, overrides: %s", JSON.stringify(txOverrides))
    const setTemplateTx = await operatorFactory.updateTemplates(
        operatorTemplate.address,
        nodeModule.address,
        queueModule.address,
        stakeModule.address,
        txOverrides
    )
    log("Set template tx: %s/tx/%s", blockExplorerUrl, setTemplateTx.hash)
    const setTemplateReceipt = await setTemplateTx.wait()
    log("Set template receipt: %o", formatReceipt(setTemplateReceipt))

    const balanceAfter = await provider.getBalance(wallet.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    if (OUTPUT_FILE) {
        writeFileSync("operatorTemplate-" + OUTPUT_FILE, operatorTemplate.address)
        writeFileSync("nodeModule-" + OUTPUT_FILE, nodeModule.address)
        writeFileSync("queueModule-" + OUTPUT_FILE, queueModule.address)
        writeFileSync("stakeModule-" + OUTPUT_FILE, stakeModule.address)
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
    main().catch(console.error)
}
