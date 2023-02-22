import { ethers as hardhatEthers } from "hardhat"
import { Chains } from "@streamr/config"
import { ProjectRegistry, StreamRegistryV4 } from "../typechain"

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
} = Chains.load()[CHAIN]

let projectRegistry: ProjectRegistry
let streamRegistry: StreamRegistryV4

const connectContracts = async () => {
    const projectRegistryFactory = await getContractFactory("ProjectRegistry")
    const projectRegistryFactoryTx = await projectRegistryFactory.attach(PROJECT_REGISTRY_ADDRESS)
    projectRegistry = await projectRegistryFactoryTx.deployed() as ProjectRegistry
    log("ProjectRegistry deployed at: ", projectRegistry.address)

    const streamRegistryFactory = await getContractFactory("StreamRegistryV4")
    const streamRegistryFactoryTx = await streamRegistryFactory.attach(STREAM_REGISTRY_ADDRESS)
    streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV4
    log("StreamRegistryV4 deployed at: ", streamRegistry.address)

    const latestBlock = await hardhatEthers.provider.getBlock("latest")
    log('latestBlock', latestBlock.number)
}

const grantTrustedRoleToProjectRegistry = async (): Promise<void> => {
    log('Granting trusted role...')
    const trustedRole = await streamRegistry.TRUSTED_ROLE()
    const tx = await streamRegistry.grantRole(trustedRole, projectRegistry.address)
    log('tx', tx.hash)
    await tx.wait()
    log('StreamRegistry granted trusted role to ProjectRegistry')
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
