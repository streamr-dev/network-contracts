import { ethers, upgrades } from "hardhat"
import { config } from "@streamr/config"

const { log } = console

const {
    CHAIN = "gnosis",
} = process.env

if (!CHAIN) { throw new Error("Please specify CHAIN environment variable (dev0, dev1, gnosis, polygon, mainnet)") }

const {
    contracts: {
        RemoteMarketplaceV1: PROXY_ADDRESS
    }
} = (config as any)[CHAIN]

if (!PROXY_ADDRESS) { throw new Error(`No RemoteMarketplaceV1 found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network gnosis scripts/upgradeRemoteMarketplace.ts
 * npx hardhat flatten contracts/Marketplace/RemoteMarketplaceV1.sol > rm.sol
 */
async function main() {
    log(`Upgrading RemoteMarketplaceV1 on ${CHAIN} chain at address ${PROXY_ADDRESS}...`)

    const RemoteMarketplaceFactory = await ethers.getContractFactory("RemoteMarketplaceV1")
    const remoteMarketplace = await upgrades.upgradeProxy(PROXY_ADDRESS, RemoteMarketplaceFactory)
    await remoteMarketplace.deployed()
    log(`Upgraded RemoteMarketplaceV1 at ${remoteMarketplace.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
