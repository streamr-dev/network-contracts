/* eslint-disable quotes */
import { writeFileSync } from "fs"

import { ethers as hhEthers, upgrades } from "hardhat"
import { config } from "@streamr/config"

const { log } = console

const {
    CHAIN = 'dev1',
    OUTPUT_FILE,
} = process.env

const {
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS, // = 0x0000000000000000000000000000000000000000
    }
} = (config as any)[CHAIN]

if (!STREAM_REGISTRY_ADDRESS) { throw new Error(`No StreamRegistry found in chain "${CHAIN}"`) }
// const STREAM_REGISTRY_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * npx hardhat run --network dev1 scripts/deployProjectRegistry.ts
 * npx hardhat flatten contracts/ProjectRegistry/ProjectRegistryV1.sol > pr.sol
 */
async function main() {
    log(`StreamRegistry address: ${STREAM_REGISTRY_ADDRESS}`)
    log(`Deploying ProjectRegistryV1 to "${CHAIN}" chain:`)
    const projectRegistryFactory = await hhEthers.getContractFactory("ProjectRegistryV1")
    const projectRegistryFactoryTx = await upgrades.deployProxy(projectRegistryFactory, [STREAM_REGISTRY_ADDRESS], { kind: 'uups' })
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log(`ProjectRegistryV1 deployed at: ${projectRegistry.address}`)

    if (OUTPUT_FILE) {
        writeFileSync(OUTPUT_FILE, projectRegistry.address)
        log(`ProjectRegistryV1 address written to ${OUTPUT_FILE}`)
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
