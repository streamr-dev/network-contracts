import { ethers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    CHAIN = "dev1",
} = process.env

if (!CHAIN) { throw new Error("Please specify CHAIN environment variable (dev0, dev1, gnosis, polygon, mainnet)") }

const {
    contracts: {
        ProjectRegistry: PROXY_ADDRESS
    }
} = Chains.load()[CHAIN]

if (!PROXY_ADDRESS) { throw new Error(`No ProjectRegistry found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network polygon scripts/upgradeProjectRegistry.ts
 */
async function main() {
    log(`Upgrading ProjectRegistry on ${CHAIN} chain at address ${PROXY_ADDRESS}...`)

    const ProjectRegistryFactory = await ethers.getContractFactory("ProjectRegistry")
    const projectRegistry = await upgrades.upgradeProxy(PROXY_ADDRESS, ProjectRegistryFactory)
    await projectRegistry.deployed()
    log(`Upgraded ProjectRegistry at ${projectRegistry.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
