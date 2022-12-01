import { ethers, upgrades } from "hardhat"

const { log } = console

/**
 * npx hardhat run --network dev1 scripts/deployMarketplaceV4.ts
 */
async function main() {
    const Marketplace = await ethers.getContractFactory("MarketplaceV4")
    const marketplace = await upgrades.deployProxy(Marketplace, [], { kind: 'uups' })
    await marketplace.deployed()
    log(`MarketplaceV4 deployed at ${marketplace.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
