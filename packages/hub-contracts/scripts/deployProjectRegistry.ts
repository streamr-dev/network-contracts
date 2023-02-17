import { ethers as hhEthers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    CHAIN = 'dev1',
} = process.env

const {
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS, // = 0x0000000000000000000000000000000000000000
    }
} = Chains.load()[CHAIN]

if (!STREAM_REGISTRY_ADDRESS) { throw new Error(`No StreamRegistry found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network dev1 scripts/deployProjectRegistry.ts
 * npx hardhat flatten contracts/ProjectRegistry/ProjectRegistry.sol > pr.sol
 */
async function main() {
    log(`StreamRegistry address: ${STREAM_REGISTRY_ADDRESS}`)
    log(`Deploying ProjectRegistry to "${CHAIN}" chain:`)
    const projectRegistryFactory = await hhEthers.getContractFactory("ProjectRegistry")
    const projectRegistryFactoryTx = await upgrades.deployProxy(projectRegistryFactory, [STREAM_REGISTRY_ADDRESS], { kind: 'uups' })
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log(`ProjectRegistry deployed at: ${projectRegistry.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
