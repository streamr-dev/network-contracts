import { ethers, upgrades } from "hardhat"
import { config } from "@streamr/config"

const { log } = console

const {
    CHAIN,
} = process.env

if (!CHAIN) { throw new Error("Please specify CHAIN environment variable (dev0, dev1, gnosis, polygon, mainnet)") }

const {
    contracts: {
        MarketplaceV3: MARKETPLACE_V3_ADDRESS
    }
} = (config as any)[CHAIN]

if (!MARKETPLACE_V3_ADDRESS) { throw new Error(`No MarketplaceV3 found in chain "${CHAIN}"`) }

// 2022-11-21: deploying a bugfix to MarketplaceV3, adding ERC677 transferAndCall to outgoing token transfer (to product beneficiary)

/**
 * npx hardhat run --network $CHAIN scripts/upgradeMarketplaceV3.ts
 */
async function main() {
    const MarketplaceV3Factory = await ethers.getContractFactory("MarketplaceV3")
    const marketplace = await upgrades.upgradeProxy(MARKETPLACE_V3_ADDRESS, MarketplaceV3Factory)
    await marketplace.deployed()
    log(`Upgraded MarketplaceV3 at ${marketplace.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
