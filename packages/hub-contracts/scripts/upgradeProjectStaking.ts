import { ethers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    CHAIN = "dev1",
} = process.env

if (!CHAIN) { throw new Error("Please specify CHAIN environment variable (dev0, dev1, gnosis, polygon, mainnet)") }

const {
    contracts: {
        ProjectStakingV1: PROXY_ADDRESS
    }
} = Chains.load()[CHAIN]

if (!PROXY_ADDRESS) { throw new Error(`No ProjectStakingV1 found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network polygon scripts/upgradeProjectStaking.ts
 * npx hardhat flatten contracts/ProjectStaking/ProjectStakingV1.sol > ps.sol
 */
async function main() {
    log(`Upgrading ProjectStakingV1 on ${CHAIN} chain at address ${PROXY_ADDRESS}...`)

    const ProjectStakingFactory = await ethers.getContractFactory("ProjectStakingV1")
    const projectStaking = await upgrades.upgradeProxy(PROXY_ADDRESS, ProjectStakingFactory)
    await projectStaking.deployed()
    log(`Upgraded ProjectStakingV1 at ${projectStaking.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
