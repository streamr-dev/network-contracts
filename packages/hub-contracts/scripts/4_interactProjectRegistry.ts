import { ethers as hardhatEthers } from "hardhat"
import { utils, Wallet, providers } from "ethers"
import { Chains } from '@streamr/config'
import { DATAv2, ProjectRegistry, StreamRegistryV3 } from "../typechain"

const { getContractFactory } = hardhatEthers
const { hexlify, toUtf8Bytes, zeroPad } = utils
const { log } = console

const {
    CHAIN = "dev1",
    DEFAULT_ADMIN: DEFAULT_PRIVATE_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // privateKeys[0]
    DEPLOYER: DEPLOYMENT_OWNER_KEY = '0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb', // privateKeys[1]
    ADMIN: PROJECT_ADMIN_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae', // privateKeys[2]
    BENEFICIARY: PROJECT_BENEFICIARY_KEY = '0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9', // privateKeys[3]
} = process.env

const {
    rpcEndpoints: [{
        url: ETHEREUM_RPC_URL
    }],
    contracts: {
        DATA: DATA_V2_ADDRESS,
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS = "0x36368Be8Cde49558Ab6ceEf2632984b282Db8775", // TODO: add address to config package
    }
} = Chains.load()[CHAIN]

let projectRegistry: ProjectRegistry
let streamRegistry: StreamRegistryV3
let dataToken: DATAv2
let defaultAdminWallet: Wallet
let deploymentOwner: Wallet
let adminWallet: Wallet
let beneficiaryWallet: Wallet

const connectWallets = () => {
    const provider = new providers.JsonRpcProvider(ETHEREUM_RPC_URL)
    defaultAdminWallet = new Wallet(DEFAULT_PRIVATE_KEY, provider)
    deploymentOwner = new Wallet(DEPLOYMENT_OWNER_KEY, provider)
    adminWallet = new Wallet(PROJECT_ADMIN_KEY, provider)
    beneficiaryWallet = new Wallet(PROJECT_BENEFICIARY_KEY, provider)
}

const connectContracts = async () => {
    const dataTokenFactory = await getContractFactory("DATAv2", defaultAdminWallet)
    const dataTokenFactoryTx = await dataTokenFactory.attach(DATA_V2_ADDRESS)
    dataToken = await dataTokenFactoryTx.deployed() as DATAv2
    log(`DATAv2 balance deployer ${deploymentOwner.address}: ${await dataToken.balanceOf(deploymentOwner.address)}`)
    log(`DATAv2 balance defaultAdmin ${defaultAdminWallet.address}: ${await dataToken.balanceOf(defaultAdminWallet.address)}`)
    log(`DATAv2 balance admin ${adminWallet.address}: ${await dataToken.balanceOf(adminWallet.address)}`)
    log(`DATAv2 balance beneficiary ${beneficiaryWallet.address}: ${await dataToken.balanceOf(beneficiaryWallet.address)}`)

    const projectRegistryFactory = await getContractFactory("ProjectRegistry")
    const projectRegistryFactoryTx = await projectRegistryFactory.attach(PROJECT_REGISTRY_ADDRESS)
    projectRegistry = await projectRegistryFactoryTx.deployed() as ProjectRegistry
    log("ProjectRegistry deployed at: ", projectRegistry.address)

    const streamRegistryFactory = await getContractFactory("StreamRegistryV3")
    const streamRegistryFactoryTx = await streamRegistryFactory.attach(STREAM_REGISTRY_ADDRESS)
    streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV3
    log("StreamRegistryV3 deployed at: ", streamRegistry.address)

    const latestBlock = await hardhatEthers.provider.getBlock("latest")
    log('latestBlock', latestBlock.number)
}

const createProject = async ({
    beneficiary = beneficiaryWallet.address,
    pricePerSecond = 1,
    pricingToken = dataToken.address,
    minimumSubscriptionSeconds = 1,
    isPublicPurchable = true,
} = {}): Promise<string> => {
    const id = hexlify(zeroPad(toUtf8Bytes('project-' + Date.now()), 32))
    const metadata = JSON.stringify({ id, createdAt: new Date().toLocaleString() })
    await(await projectRegistry.connect(adminWallet)
        .createProject(id, beneficiary, pricePerSecond, pricingToken, minimumSubscriptionSeconds, isPublicPurchable, metadata)).wait()
    log('Project created (id: %s)', id)
    return id
}

const deleteProject = async (id: string): Promise<void> => {
    await(await projectRegistry.connect(adminWallet)
        .deleteProject(id)).wait()
    log('Project deleted (id: %s)', id)
}

const updateProject = async ({
    id,
    beneficiary = beneficiaryWallet.address,
    pricePerSecond = 1,
    pricingToken = dataToken.address,
    minimumSubscriptionSeconds = 1,
    metadata = 'metadata-updated-at: ' + new Date().toLocaleString(),
}: any): Promise<void> => {
    await(await projectRegistry.connect(adminWallet)
        .updateProject(id, beneficiary, pricePerSecond, pricingToken, minimumSubscriptionSeconds, metadata)).wait()
    log('Project updated (id: %s)', id)
}

const setPermission = async ({
    projectId,
    userAddress,
    canBuy = true,
    canDelete = true,
    canEdit = true,
    canGrant = true
}: any) => {
    await(await projectRegistry.connect(adminWallet)
        .setPermissionBooleans(projectId, userAddress, canBuy, canDelete, canEdit, canGrant)).wait()
}

const grantSubscription = async (projectId: string, userAddress = Wallet.createRandom().address) => {
    await(await projectRegistry.connect(adminWallet)
        .grantSubscription(projectId, 100, userAddress)).wait()
}

const createStream = async (): Promise<string> => {
    // create streams using the StreamRegistry contract (will give admin all permisisons to the stream)
    const streamPath = '/projects/' + Date.now()
    const streamMetadata = `{"date": "${new Date().toLocaleString()}", "creator": "${adminWallet.address}"}`
    await(await streamRegistry.connect(adminWallet)
        .createStream(streamPath, streamMetadata)).wait()
    const streamId = adminWallet.address.toLowerCase() + streamPath
    return streamId
}

const addStream = async (projectId: string, streamId: string): Promise<void> => {
    enum StreamRegistryPermissionType { Edit, Delete, Publish, Subscribe, Grant }
    // enable Grant subscription for stream to project registry
    // the address adding a stream to project needs Edit permision on the project and Grant permission on the stream
    await(await streamRegistry.connect(adminWallet)
        .grantPermission(streamId, projectRegistry.address, StreamRegistryPermissionType.Grant)).wait()
    await(await projectRegistry.connect(adminWallet)
        .addStream(projectId, streamId)).wait()
    log('Stream added (projectId: %s, streamId: %s)', projectId, streamId)
}

const removeStream = async (projectId: string, streamId: string): Promise<void> => {
    await(await projectRegistry.connect(adminWallet)
        .removeStream(projectId, streamId)).wait()
    log('Stream removed (projectId: %s, streamId: %s)', projectId, streamId)
}

/**
 * npx hardhat run --network dev1 scripts/4_interactProjectRegistry.ts
 */
async function main() {
    connectWallets()
    await connectContracts()
    const projectId = await createProject()
    await updateProject({ id: projectId, pricePerSecond: 2 })
    await setPermission({ projectId, userAddress: Wallet.createRandom().address })
    const streamId = await createStream()
    await addStream(projectId, streamId)
    await grantSubscription(projectId)
    await removeStream(projectId, streamId)
    await deleteProject(projectId)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
