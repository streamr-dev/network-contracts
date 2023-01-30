import { ethers as hhEthers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    CHAIN = 'dev1',
} = process.env

const {
    contracts: {
        DATA: STAKING_TOKEN_ADDRESS, // LINK dev1 - 0x3387F44140ea19100232873a5aAf9E46608c791E
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS,
    }
} = Chains.load()[CHAIN]

if (!PROJECT_REGISTRY_ADDRESS) { throw new Error(`No ProjectRegistry found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network dev1 scripts/deployProjectStakingV1.ts
 * npx hardhat flatten contracts/ProjectStaking/ProjectStakingV1.sol > ps.sol
 */
async function main() {
    log(`ProjectRegistry address: ${PROJECT_REGISTRY_ADDRESS}`)
    log(`Staking token address: ${PROJECT_REGISTRY_ADDRESS}`)
    log(`Deploying ProjectStakingV1 to "${CHAIN}" chain:`)
    const projectStakingFactory = await hhEthers.getContractFactory("ProjectStakingV1")
    const projectStakingFactoryTx = await upgrades.deployProxy(projectStakingFactory, [
        PROJECT_REGISTRY_ADDRESS,
        STAKING_TOKEN_ADDRESS
    ], { kind: 'uups' })
    const projectStaking = await projectStakingFactoryTx.deployed()
    log(`ProjectStakingV1 deployed at: ${projectStaking.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
