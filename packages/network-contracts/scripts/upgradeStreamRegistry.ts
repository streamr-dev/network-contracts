/* eslint-disable require-atomic-updates,max-len */
import { writeFileSync } from "fs"
import { upgrades, ethers as hardhatEthers } from "hardhat"
import { config } from "@streamr/config"

import type { Wallet, Overrides } from "ethers"
import type { StreamRegistry } from "@streamr/network-contracts"
import { StreamRegistryV5 } from "../typechain"

const { parseUnits } = hardhatEthers.utils
const { log } = console

const {
    provider, // specified in hardhat.config.ts
    getSigners, // specified in hardhat.config.ts, read from environment variable KEY
    getContractFactory,
    utils: { formatEther },
} = hardhatEthers

const {
    CHAIN = "dev2",
    // these come from hardhat.config.ts
    // ETHEREUM_RPC,
    // KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    GAS_PRICE_GWEI,
    CONTRACT_NAME = "StreamRegistryV5",

    REGISTRY_ADDRESS,

    // IGNORE_BALANCE,
    OUTPUT_FILE,
} = process.env

const {
    contracts: {
        StreamRegistry: registryAddressFromConfig,
    },
    // blockExplorerUrl = "",
} = (config as any)[CHAIN]

// TODO: add to @streamr/config
// const blockExplorerUrl = (config as any)[CHAIN].blockExplorerUrl ?? ""

const txOverrides: Overrides = {}
if (GAS_PRICE_GWEI) {
    txOverrides.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei")
}

async function main() {
    const [ signer ] = await getSigners() as Wallet[] // specified in hardhat.config.ts
    log("Checking network %s", CHAIN)
    log("    %o", await provider.getNetwork())

    const streamRegistry = await (await getContractFactory("StreamRegistry", { signer })).attach(REGISTRY_ADDRESS ?? registryAddressFromConfig) as StreamRegistry
    log("Checking StreamRegistry at %s", streamRegistry.address)
    const codeLength = await provider.getCode(streamRegistry.address).then((code: string) => code.length)
    if (codeLength < 3) { throw new Error("No contract found at " + streamRegistry.address) }
    log("    %s [OK]", await streamRegistry.TRUSTED_ROLE())

    // const gasRequired = 60000000 // measured in hardhat test network
    // const gasPrice = await provider.getGasPrice()
    // const estimatedGasCost = gasPrice.mul(gasRequired)
    // log("Estimated gas cost: %s ETH (gas price %s gwei)", formatEther(estimatedGasCost), formatUnits(gasPrice, "gwei"))

    const balanceBefore = await provider.getBalance(signer.address)
    log("Balance of %s: %s ETH", signer.address, formatEther(balanceBefore))
    // if (balanceBefore.lt(estimatedGasCost)) {
    //     if (!IGNORE_BALANCE) {
    //         throw new Error(
    //             `Insufficient native tokens for deployment in ${signer.address} (${formatEther(balanceBefore)} < ${formatEther(estimatedGasCost)})`
    //         )
    //     }
    // }

    // see https://docs.openzeppelin.com/upgrades-plugins/1.x/api-hardhat-upgrades
    const upgradedStreamRegistry = await upgrades.upgradeProxy(
        streamRegistry.address,
        await getContractFactory(CONTRACT_NAME, { signer, txOverrides })
    ) as StreamRegistryV5
    log("Checking new StreamRegistry at %s", upgradedStreamRegistry.address)
    log("    %s [OK]", await upgradedStreamRegistry.getUserKeyForUserId("test.eth/1", "0x1234"))

    const balanceAfter = await provider.getBalance(signer.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    if (OUTPUT_FILE) {
        writeFileSync(OUTPUT_FILE, upgradedStreamRegistry.address)
    }
}

if (require.main === module) {
    main().catch(console.error)
}
