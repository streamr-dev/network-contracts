/* eslint-disable quotes */
import { ethers as hardhatEthers, upgrades } from "hardhat"
import { config } from "@streamr/config"
import { utils } from "ethers"
import { chainToMailboxAddress } from "./utils"

const { getContractFactory } = hardhatEthers
const { id } = utils
const { log } = console

const {
    CHAIN = 'dev1',
    PROJECT_REGISTRY_ADDRESS,
} = process.env

const {
    id: CHAIN_ID,
    contracts: {
        ProjectRegistryV1: PROJECT_REGISTRY_ADDRESS_FROM_CONFIG,
    }
} = (config as any)[CHAIN]

const projectRegistryAddress = PROJECT_REGISTRY_ADDRESS || PROJECT_REGISTRY_ADDRESS_FROM_CONFIG
if (!projectRegistryAddress) {
    throw new Error(`No ProjectRegistryV1 found in chain "${CHAIN}", please supply it in env variable PROJECT_REGISTRY_ADDRESS`)
}

const interchainMailbox = chainToMailboxAddress(CHAIN)

/**
 * npx hardhat run --network dev1 scripts/deployMarketplaceV4.ts
 * npx hardhat flatten contracts/MarketplaceV4.sol > mpv4.sol
 */
async function main() {
    log(`Deploying MarketplaceV4 to ${CHAIN}:`)
    log(`   - project registry address: ${projectRegistryAddress}`)

    const projectRegistryFactory = await getContractFactory("ProjectRegistryV1")
    const projectRegistryFactoryTx = await projectRegistryFactory.attach(projectRegistryAddress)
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log("ProjectRegistryV1 attached at: ", projectRegistry.address)

    log(`Deploying MarketplaceV4 to ${CHAIN}:`)
    const Marketplace = await getContractFactory("MarketplaceV4")
    const marketplace = await upgrades.deployProxy(Marketplace, [projectRegistry.address, CHAIN_ID], { kind: 'uups' })
    await marketplace.deployed()
    log(`MarketplaceV4 deployed on ${CHAIN} at: ${marketplace.address}`)

    try {
        await (await marketplace.addMailbox(interchainMailbox)).wait()
        log(`MarketplaceV4 added interchain mailbox: ${interchainMailbox}`)
    } catch (error) {
        log(`Error when setting interchain mailbox: ${error}`)
    }
    await projectRegistry.grantRole(id("TRUSTED_ROLE"), marketplace.address)
    log(`ProjectRegistry granted trusted role to MarketplaceV4.`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
