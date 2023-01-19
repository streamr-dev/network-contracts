import { ethers as hardhatEthers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"
import { utils } from "ethers"
import { chainToDomainId } from "../utils"

const { getContractFactory } = hardhatEthers
const { id } = utils
const { log } = console

const {
    DESTINATION_CHAIN = 'dev1',
} = process.env

const {
    contracts: {
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS,
    }
} = Chains.load()[DESTINATION_CHAIN]

if (!PROJECT_REGISTRY_ADDRESS) { throw new Error(`No ProjectRegistry found in chain "${DESTINATION_CHAIN}"`) }

const destinationDomainId = chainToDomainId(DESTINATION_CHAIN)

/**
 * npx hardhat run --network dev1 scripts/deployMarketplaceV4.ts
 * npx hardhat flatten contracts/MarketplaceV4.sol > mpv4.sol
 */
async function main() {
    log(`Deploying MarketplaceV4 to ${DESTINATION_CHAIN}:`)
    log(`   - project registry address: ${PROJECT_REGISTRY_ADDRESS}`)

    const projectRegistryFactory = await getContractFactory("ProjectRegistry")
    const projectRegistryFactoryTx = await projectRegistryFactory.attach(PROJECT_REGISTRY_ADDRESS)
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log("ProjectRegistry attached at: ", projectRegistry.address)

    log(`Deploying MarketplaceV4 to ${DESTINATION_CHAIN}:`)
    const Marketplace = await getContractFactory("MarketplaceV4")
    const marketplace = await upgrades.deployProxy(Marketplace, [projectRegistry.address, destinationDomainId], { kind: 'uups' })
    await marketplace.deployed()
    log(`MarketplaceV4 deployed on ${DESTINATION_CHAIN} at: ${marketplace.address}`)

    await projectRegistry.grantRole(id("TRUSTED_ROLE"), marketplace.address)
    log(`ProjectRegistry granted trusted role to MarketplaceV4.`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
