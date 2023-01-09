import { ethers as hardhatEthers } from "hardhat"
import { utils, Wallet, providers, BigNumber } from "ethers"
import { Chains } from "@streamr/config"
import { DATAv2, ProjectRegistry, StreamRegistryV3 } from "../typechain"

const { getContractFactory } = hardhatEthers
const { hexlify, toUtf8Bytes, zeroPad } = utils
const { log } = console

const {
    CHAIN = 'dev1',
    DEFAULT_ADMIN: DEFAULT_PRIVATE_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // privateKeys[0]
    DEPLOYER: DEPLOYMENT_OWNER_KEY = '0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb', // privateKeys[1]
    ADMIN: PROJECT_ADMIN_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae', // privateKeys[2]
    BENEFICIARY: PROJECT_BENEFICIARY_KEY = '0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9', // privateKeys[3]
    BUYER: PROJECT_BUYER_KEY = '0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297', // privateKeys[4]
} = process.env

const {
    rpcEndpoints: [{
        url: ETHEREUM_RPC_URL
    }],
    contracts: {
        DATA: DATA_V2_ADDRESS,
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS,
    }
} = Chains.load()[CHAIN]

let projectRegistry: ProjectRegistry
let streamRegistry: StreamRegistryV3
let dataToken: DATAv2
let defaultAdminWallet: Wallet
let deploymentOwner: Wallet
let adminWallet: Wallet
let beneficiaryWallet: Wallet
const domainIds: number[] = []
const paymentDetailsDefault: any[] = [] // PaymentDetails[]

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
    id = hexlify(zeroPad(toUtf8Bytes('project-' + Date.now()), 32)),
    paymentDetails = paymentDetailsDefault,
    minimumSubscriptionSeconds = 1,
    isPublicPurchable = true,
} = {}): Promise<string> => {
    const metadata = JSON.stringify({ description: 'paid-project', purchableOn: domainIds })
    await(await projectRegistry.connect(adminWallet)
        .createProject(id, domainIds, paymentDetails, minimumSubscriptionSeconds, isPublicPurchable, metadata)).wait()
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
    paymentDetails = paymentDetailsDefault,
    minimumSubscriptionSeconds = 1,
    metadata = 'metadata-updated-at: ' + new Date().toLocaleString(),
}: any): Promise<void> => {
    await(await projectRegistry.connect(adminWallet)
        .updateProject(id, domainIds, paymentDetails, minimumSubscriptionSeconds, metadata)).wait()
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
    log('Permission set (projectId: %s, userAddress: %s)', projectId, userAddress)
}

const grantSubscription = async (projectId: string, userAddress = Wallet.createRandom().address) => {
    await(await projectRegistry.connect(adminWallet)
        .grantSubscription(projectId, 100, userAddress)).wait()
    log('Subscription granted (projectId: %s, userAddress: %s)', projectId, userAddress)
}

const createStream = async (): Promise<string> => {
    // create streams using the StreamRegistry contract (will give admin all permisisons to the stream)
    const streamPath = '/projects/' + Date.now()
    const streamMetadata = `{"date": "${new Date().toLocaleString()}", "creator": "${adminWallet.address}"}`
    await(await streamRegistry.connect(adminWallet)
        .createStream(streamPath, streamMetadata)).wait()
    const streamId = adminWallet.address.toLowerCase() + streamPath
    log('Stream created (streamId: %s)', streamId)
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

const addPaymentDetails = (domainId: number, beneficiary: string, pricingTokenAddress: string, pricePerSecond: number): void => {
    domainIds.push(domainId)
    paymentDetailsDefault.push([
        beneficiary,
        pricingTokenAddress,
        pricePerSecond
    ])
    log('Payment details added (domainId: %s, beneficiary: %s, pricingTokenAddress: %s, pricePerSecond: %s)', domainId, beneficiary, pricingTokenAddress, pricePerSecond)
}

/**
 * npx hardhat run --network dev1 scripts/interactProjectRegistry.ts
 */
async function main() {
    connectWallets()
    await connectContracts()
    addPaymentDetails(8997, beneficiaryWallet.address, dataToken.address, 2) // dev1
    const projectId = await createProject()
    await updateProject({ id: projectId, pricePerSecond: 2 })
    await setPermission({ projectId, userAddress: Wallet.createRandom().address })
    const streamId = await createStream()
    await addStream(projectId, streamId)
    await grantSubscription(projectId)
    await removeStream(projectId, streamId)
    await deleteProject(projectId)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
