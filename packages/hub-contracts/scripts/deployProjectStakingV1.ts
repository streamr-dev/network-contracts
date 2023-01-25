import { ethers as hhEthers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    CHAIN = 'dev1',
} = process.env

const {
    contracts: {
        LINK: STAKING_TOKEN_ADDRESS = '0x3387F44140ea19100232873a5aAf9E46608c791E', // dev1
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS,
    }
} = Chains.load()[CHAIN]

if (!PROJECT_REGISTRY_ADDRESS) { throw new Error(`No ProjectRegistry found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network dev1 scripts/deployProjectStakingV1.ts
 * npx hardhat flatten contracts/ProjectStakingV1.sol > pr.sol
 */
async function main() {
    log(`Deploying ProjectStakingV1 to ${CHAIN}:`)
    const projectStakingFactory = await hhEthers.getContractFactory("ProjectStakingV1")
    const projectStakingFactoryTx = await upgrades.deployProxy(projectStakingFactory, [PROJECT_REGISTRY_ADDRESS, STAKING_TOKEN_ADDRESS], { kind: 'uups' })
    const projectStaking = await projectStakingFactoryTx.deployed()
    log(`ProjectStakingV1 deployed at: ${projectStaking.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
