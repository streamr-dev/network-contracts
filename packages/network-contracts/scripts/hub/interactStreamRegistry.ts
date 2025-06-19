/* eslint-disable quotes */
import { ethers as hardhatEthers } from "hardhat"
import { config } from "@streamr/config"
import { ProjectRegistryV1, StreamRegistryV5 } from "../../typechain"

const { getContractFactory } = hardhatEthers

// export const log = (..._: unknown[]): void => { /* skip logging */ }
const { log } = console

const {
    CHAIN = 'polygon',
} = process.env

const {
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS,
    }
} = (config as any)[CHAIN]

let projectRegistry: ProjectRegistryV1
let streamRegistry: StreamRegistryV5

const connectContracts = async () => {
    const projectRegistryFactory = await getContractFactory("ProjectRegistryV1")
    const projectRegistryFactoryTx = await projectRegistryFactory.attach(PROJECT_REGISTRY_ADDRESS)
    projectRegistry = await projectRegistryFactoryTx.deployed() as ProjectRegistryV1
    log("ProjectRegistryV1 deployed at: ", projectRegistry.address)

    const streamRegistryFactory = await getContractFactory("StreamRegistryV5")
    const streamRegistryFactoryTx = await streamRegistryFactory.attach(STREAM_REGISTRY_ADDRESS)
    streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV5
    log("StreamRegistryV5 deployed at: ", streamRegistry.address)

    const latestBlock = await hardhatEthers.provider.getBlock("latest")
    log('latestBlock', latestBlock.number)
}

const grantTrustedRoleToProjectRegistry = async (): Promise<void> => {
    log('Granting trusted role...')
    const trustedRole = await streamRegistry.TRUSTED_ROLE()
    const tx = await streamRegistry.grantRole(trustedRole, projectRegistry.address)
    log('tx', tx.hash)
    await tx.wait()
    log('StreamRegistry granted trusted role to ProjectRegistryV1')
}

/**
 * npx hardhat run --network polygon scripts/interactStreamRegistry.ts
 */
async function main() {
    await connectContracts()

    await grantTrustedRoleToProjectRegistry()
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
