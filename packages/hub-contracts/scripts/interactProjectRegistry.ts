import { ethers as hardhatEthers } from "hardhat"
import { utils, Wallet, providers } from "ethers"
import { Chains } from "@streamr/config"
import { DATAv2, MarketplaceV4, ProjectRegistry, StreamRegistryV4 } from "../typechain"

const { getContractFactory } = hardhatEthers
const { hexlify, toUtf8Bytes, zeroPad } = utils
const { log } = console

const {
    CHAIN = 'dev1',
    DEPLOYER: DEPLOYER_PRIVATE_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // privateKeys[0]
    ADMIN: PROJECT_ADMIN_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae', // privateKeys[2]
} = process.env

const {
    rpcEndpoints: [{
        url: ETHEREUM_RPC_URL
    }],
    contracts: {
        DATA: DATA_V2_ADDRESS,
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
        ProjectRegistry: PROJECT_REGISTRY_ADDRESS,
        MarketplaceV4: MARKETPLACE_ADDRESS,
    }
} = Chains.load()[CHAIN]

let projectRegistry: ProjectRegistry
let streamRegistry: StreamRegistryV4
let marketplace: MarketplaceV4
let dataToken: DATAv2
let deployerWallet: Wallet
let adminWallet: Wallet
const domainIds: number[] = []
const paymentDetailsDefault: any[] = [] // PaymentDetailsByChain[]

const connectWallets = () => {
    const provider = new providers.JsonRpcProvider(ETHEREUM_RPC_URL)
    deployerWallet = new Wallet(DEPLOYER_PRIVATE_KEY, provider)
    adminWallet = new Wallet(PROJECT_ADMIN_KEY, provider)
}

const connectContracts = async () => {
    const dataTokenFactory = await getContractFactory("DATAv2", deployerWallet)
    const dataTokenFactoryTx = await dataTokenFactory.attach(DATA_V2_ADDRESS)
    dataToken = await dataTokenFactoryTx.deployed() as DATAv2
    log("DATAv2 deployed at: ", dataToken.address)

    const projectRegistryFactory = await getContractFactory("ProjectRegistry", deployerWallet)
    const projectRegistryFactoryTx = await projectRegistryFactory.attach(PROJECT_REGISTRY_ADDRESS)
    projectRegistry = await projectRegistryFactoryTx.deployed() as ProjectRegistry
    log("ProjectRegistry deployed at: ", projectRegistry.address)

    const streamRegistryFactory = await getContractFactory("StreamRegistryV4", deployerWallet)
    const streamRegistryFactoryTx = await streamRegistryFactory.attach(STREAM_REGISTRY_ADDRESS)
    streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV4
    log("StreamRegistryV4 deployed at: ", streamRegistry.address)

    const marketplaceV4Factory = await getContractFactory("MarketplaceV4", deployerWallet)
    const marketplaceV4FactoryTx = await marketplaceV4Factory.attach(MARKETPLACE_ADDRESS)
    marketplace = await marketplaceV4FactoryTx.deployed() as MarketplaceV4
    log("MarketplaceV4 deployed at: ", marketplace.address)

    const latestBlock = await hardhatEthers.provider.getBlock("latest")
    log('latestBlock', latestBlock.number)
}

// const buyProject = async (
//     projectId: string,
//     subscriptionSeconds: number,
//     buyer: Wallet
// ): Promise<void> => {
//     let tx
//     if(buyer) {
//         log('   - buyer: ', buyer.address)
//         tx = await marketplace.connect(buyer).buy(projectId, subscriptionSeconds)
//     } else {
//         tx = await marketplace.buy(projectId, subscriptionSeconds) // uses the cli exported KEY
//     }
//     log('   - subscriptionSeconds: ', subscriptionSeconds)
//     log('   - projectId: ', projectId)
//     await tx.wait()
// }

const createProject = async ({
    id = hexlify(zeroPad(toUtf8Bytes('project-' + Date.now()), 32)),
    paymentDetails = paymentDetailsDefault,
    streams = [],
    minimumSubscriptionSeconds = 1,
    metadata = JSON.stringify({ description: `CreatedAt: ${new Date().toLocaleString()}`, purchableOn: domainIds }),
    isPublicPurchable = true,
    creator = adminWallet,
}: any): Promise<string> => {
    await(await projectRegistry.connect(creator)
        .createProject(id, domainIds, paymentDetails, streams, minimumSubscriptionSeconds, isPublicPurchable, metadata)).wait()
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
    streams = [],
    minimumSubscriptionSeconds = 1,
    metadata = 'metadata-updated-at: ' + new Date().toLocaleString(),
    projectAdmin = adminWallet,
}: any): Promise<void> => {
    await(await projectRegistry.connect(projectAdmin)
        .updateProject(id, domainIds, paymentDetails, streams, minimumSubscriptionSeconds, metadata)).wait()
    log('Project updated (id: %s)', id)
}

const setPermission = async ({
    projectId,
    userAddress = Wallet.createRandom().address,
    canBuy = true,
    canDelete = true,
    canEdit = true,
    canGrant = true
}: any) => {
    await(await projectRegistry.connect(adminWallet)
        .setPermissionBooleans(projectId, userAddress, canBuy, canDelete, canEdit, canGrant)).wait()
    log('Permission set (projectId: %s, userAddress: %s)', projectId, userAddress)
}

const grantSubscription = async ({
    projectId,
    userAddress = Wallet.createRandom().address,
    subscriptionSeconds = 100,
    projectAdmin = adminWallet
}: any) => {
    await(await projectRegistry.connect(projectAdmin)
        .grantSubscription(projectId, subscriptionSeconds, userAddress)).wait()
    log('Subscription granted (projectId: %s, userAddress: %s, subscriptionSeconds: %s)', projectId, userAddress, subscriptionSeconds)
}

const createStream = async (creator = adminWallet): Promise<string> => {
    // create streams using the StreamRegistry contract (will give admin all permisisons to the stream)
    const streamPath = '/projects/' + Date.now()
    const streamMetadata = `{"date": "${new Date().toLocaleString()}", "creator": "${creator.address}"}`
    await(await streamRegistry.connect(creator)
        .createStream(streamPath, streamMetadata)).wait()
    const streamId = creator.address.toLowerCase() + streamPath
    log('Stream created (streamId: %s)', streamId)
    return streamId
}

const addStream = async (projectId: string, streamId: string): Promise<void> => {
    // the address adding a stream to project needs Edit permision on the project and Grant permission on the stream
    await(await projectRegistry.connect(adminWallet)
        .addStream(projectId, streamId)).wait()
    log('Stream added (projectId: %s, streamId: %s)', projectId, streamId)
}

const removeStream = async (projectId: string, streamId: string): Promise<void> => {
    await(await projectRegistry.connect(adminWallet)
        .removeStream(projectId, streamId)).wait()
    log('Stream removed (projectId: %s, streamId: %s)', projectId, streamId)
}

const updatePaymentDetails = (domainId: number, beneficiary: string, pricingTokenAddress: string, pricePerSecond: number): void => {
    domainIds.push(domainId)
    paymentDetailsDefault.push([
        beneficiary,
        pricingTokenAddress,
        pricePerSecond
    ])
    log('Payment details added (domainId: %s, beneficiary: %s, pricingTokenAddress: %s, pricePerSecond: %s)',
        domainId, beneficiary, pricingTokenAddress, pricePerSecond)
}

/**
 * npx hardhat run --network dev1 scripts/interactProjectRegistry.ts
 */
async function main() {
    connectWallets()
    await connectContracts()
    
    updatePaymentDetails(8997, adminWallet.address, dataToken.address, 2) // dev1

    const streamId1 = await createStream()
    const projectId = await createProject({streams: [streamId1]})
    await updateProject({ id: projectId, streams: [], minimumSubscriptionSeconds: 2 })

    await setPermission({ projectId }) // defaults to a random address
    await grantSubscription({ projectId }) // defaults to a random address

    const streamId2 = await createStream()
    await addStream(projectId, streamId2)
    await removeStream(projectId, streamId2)

    await deleteProject(projectId)

    // console.log(`Existing project: ${await projectRegistry.getProject(projectId, [8997])}`)
    // console.log(`Purchase info: ${await marketplace.getPurchaseInfo(projectId, 100, domainIds[0], 1)}`)
    // await buyProject(projectId, 100, adminWallet)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
