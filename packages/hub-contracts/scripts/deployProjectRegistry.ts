import { ethers as hhEthers, upgrades } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    CHAIN = 'dev1',
} = process.env

const {
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
    }
} = Chains.load()[CHAIN]

if (!STREAM_REGISTRY_ADDRESS) { throw new Error(`No StreamRegistry found in chain "${CHAIN}"`) }

/**
 * npx hardhat run --network dev1 scripts/deployProjectRegistry.ts
 */
async function main() {
    const projectRegistryFactory = await hhEthers.getContractFactory("ProjectRegistry")
    const projectRegistryFactoryTx = await upgrades.deployProxy(projectRegistryFactory, [STREAM_REGISTRY_ADDRESS], { kind: 'uups' })
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log("ProjectRegistry deployed at: ", projectRegistry.address)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
