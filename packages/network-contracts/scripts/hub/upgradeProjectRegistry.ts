import { ethers, upgrades } from "hardhat"
import { config } from "@streamr/config"

const { log } = console

const {
    CHAIN = "dev1",
} = process.env

if (!CHAIN) { throw new Error("Please specify CHAIN environment variable (dev0, dev1, gnosis, polygon, mainnet)") }

const {
    contracts: {
        ProjectRegistryV1: PROXY_ADDRESS
    }
} = (config as any)[CHAIN]

if (!PROXY_ADDRESS) { throw new Error(`No ProjectRegistryV1 found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network polygon scripts/upgradeProjectRegistry.ts
 * npx hardhat flatten contracts/ProjectRegistry/ProjectRegistryV1.sol > pr.sol
 */
async function main() {
    log(`Upgrading ProjectRegistryV1 on ${CHAIN} chain at address ${PROXY_ADDRESS}...`)

    const ProjectRegistryFactory = await ethers.getContractFactory("ProjectRegistryV1")
    const projectRegistry = await upgrades.upgradeProxy(PROXY_ADDRESS, ProjectRegistryFactory)
    await projectRegistry.deployed()
    log(`Upgraded ProjectRegistryV1 at ${projectRegistry.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
