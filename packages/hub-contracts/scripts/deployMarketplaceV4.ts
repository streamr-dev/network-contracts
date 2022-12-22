import { ethers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    CHAIN = 'dev1',
} = process.env

const {
    contracts: {
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS,
    }
} = Chains.load()[CHAIN]

if (!PROJECT_REGISTRY_ADDRESS) { throw new Error(`No ProjectRegistry found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network dev1 scripts/deployMarketplaceV4.ts
 */
async function main() {
    const Marketplace = await ethers.getContractFactory("MarketplaceV4")
    const marketplace = await upgrades.deployProxy(Marketplace, [], { kind: 'uups' })
    await marketplace.deployed()
    log(`MarketplaceV4 deployed at ${marketplace.address}`)

    await marketplace.setProjectRegistry(PROJECT_REGISTRY_ADDRESS)
    log(`MarketplaceV4 set the project registry: ${PROJECT_REGISTRY_ADDRESS}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
