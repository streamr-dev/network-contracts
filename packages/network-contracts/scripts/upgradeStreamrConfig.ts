/* eslint-disable require-atomic-updates,max-len */
import { writeFileSync } from "fs"
import { upgrades, ethers as hardhatEthers } from "hardhat"
import { config } from "@streamr/config"

import type { Wallet, Overrides } from "ethers"
import type { StreamrConfig } from "@streamr/network-contracts"

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

    STREAMR_CONFIG_ADDRESS,

    // IGNORE_BALANCE,
    OUTPUT_FILE,
} = process.env

const {
    contracts: {
        StreamrConfig: streamrConfigAddressFromConfig,
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

    const streamrConfig = await (await getContractFactory("StreamrConfig", { signer })).attach(STREAMR_CONFIG_ADDRESS ?? streamrConfigAddressFromConfig)
    log("Checking StreamrConfig at %s", streamrConfig.address)
    const codeLength = await provider.getCode(streamrConfig.address).then((code: string) => code.length)
    if (codeLength < 3) { throw new Error("No contract found at " + streamrConfig.address) }
    log("    %s [OK]", await streamrConfig.CONFIGURATOR_ROLE())

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
    const upgradedStreamrConfig = await upgrades.upgradeProxy(
        streamrConfig.address,
        await getContractFactory("StreamrConfigV1_1", { signer, txOverrides })
    ) as StreamrConfig
    log("Checking new StreamrConfig at %s", upgradedStreamrConfig.address)
    log("    %s [OK]", await upgradedStreamrConfig.minimumDelegationSeconds())

    const balanceAfter = await provider.getBalance(signer.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    if (OUTPUT_FILE) {
        writeFileSync(OUTPUT_FILE, upgradedStreamrConfig.address)
    }
}

if (require.main === module) {
    main().catch(console.error)
}
