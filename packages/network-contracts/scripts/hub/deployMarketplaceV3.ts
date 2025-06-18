import { ethers, upgrades } from "hardhat"

const { log } = console

/**
 * npx hardhat run --network dev1 scripts/deployMarketplaceV3.ts
 */
async function main() {
    const Marketplace = await ethers.getContractFactory("MarketplaceV3")
    const marketplace = await upgrades.deployProxy(Marketplace, [], { kind: 'uups' })
    await marketplace.deployed()
    log(`MarketplaceV3 deployed at ${marketplace.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
