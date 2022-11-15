import { ethers as hhEthers, upgrades } from "hardhat"
import { Chains } from "@streamr-contracts/config"

const { log } = console

const {
    CHAIN = "dev1",
} = process.env

const {
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
    }
} = Chains.load()[CHAIN]

/**
 * npx hardhat run --network dev1 scripts/3_deployProjectRegistry.ts
 */
async function main() {
    const projectRegistryFactory = await hhEthers.getContractFactory("ProjectRegistry")
    const projectRegistryFactoryTx = await upgrades.deployProxy(projectRegistryFactory, [STREAM_REGISTRY_ADDRESS], { kind: 'uups' })
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log("ProjectRegistry deployed at: ", projectRegistry.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
