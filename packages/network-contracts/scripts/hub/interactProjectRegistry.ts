/* eslint-disable quotes */
import { ethers as hardhatEthers } from "hardhat"
import { utils, Wallet, providers } from "ethers"
import { config } from "@streamr/config"
// import { chainToDomainId, chainToMailboxAddress } from "../utils"
import { DATAv2, MarketplaceV4, ProjectRegistryV1, StreamRegistryV5, ProjectStakingV1 } from "../../typechain"

const { getContractFactory } = hardhatEthers
const { hexlify, toUtf8Bytes, zeroPad } = utils
// export const log = (..._: unknown[]): void => { /* skip logging */ }
const { log } = console

const {
    CHAIN = 'dev1',
    REMOTE_CHAIN = 'goerli', // where RemoteMarketplace is deployed
    DEPLOYER: DEPLOYER_PRIVATE_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // privateKeys[0]
    ADMIN: PROJECT_ADMIN_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae', // privateKeys[2]
    BUYER: BUYER_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae', // deployer/owner of LINK token
} = process.env

const {
    rpcEndpoints: [{
        url: ETHEREUM_RPC_URL
    }],
    contracts: {
        DATA: DATA_V2_ADDRESS,
        LINK: LINK_TOKEN_ADDRESS = '0x3387F44140ea19100232873a5aAf9E46608c791E',
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
        ProjectRegistryV1: PROJECT_REGISTRY_ADDRESS,
        MarketplaceV4: MARKETPLACE_ADDRESS,
        ProjectStakingV1: PROJECT_STAKING_ADDRESS = '0xBFCF120a8fD17670536f1B27D9737B775b2FD4CF',
    }
} = (config as any)[CHAIN]
// const LINK_TOKEN_ADDRESS = '0x326C977E6efc84E512bB9C30f76E30c160eD06FB' // TODO: deploy to amoy?

let projectRegistry: ProjectRegistryV1
let projectStaking: ProjectStakingV1
let streamRegistry: StreamRegistryV5
let marketplace: MarketplaceV4
let dataToken: DATAv2
let linkToken: any
let deployerWallet: Wallet
let adminWallet: Wallet
let buyerWallet: Wallet
const domainIds: number[] = []
const paymentDetailsDefault: any[] = [] // PaymentDetailsByChain[]

const connectWallets = () => {
    const provider = new providers.JsonRpcProvider(ETHEREUM_RPC_URL)
    // const provider = new providers.JsonRpcProvider('https://polygon-amoy-bor-rpc.publicnode.com')
    deployerWallet = new Wallet(DEPLOYER_PRIVATE_KEY, provider)
    adminWallet = new Wallet(PROJECT_ADMIN_KEY, provider)
    buyerWallet = new Wallet(BUYER_KEY, provider)
}

const connectContracts = async () => {
    const dataTokenFactory = await getContractFactory("DATAv2", deployerWallet)
    const dataTokenFactoryTx = await dataTokenFactory.attach(DATA_V2_ADDRESS)
    dataToken = await dataTokenFactoryTx.deployed() as DATAv2
    log("DATAv2 deployed at: ", dataToken.address)

    const linkTokenFactory = await getContractFactory("DATAv2", buyerWallet) // used DATAv2 contract interface for common ERC20 functions
    const linkTokenFactoryTx = await linkTokenFactory.attach(LINK_TOKEN_ADDRESS)
    linkToken = await linkTokenFactoryTx.deployed()
    log("LinkToken deployed at: ", linkToken.address)
    log("LinkToken balance buyer: ", await linkToken.balanceOf(buyerWallet.address))

    const projectRegistryFactory = await getContractFactory("ProjectRegistryV1", deployerWallet)
    const projectRegistryFactoryTx = await projectRegistryFactory.attach(PROJECT_REGISTRY_ADDRESS)
    projectRegistry = await projectRegistryFactoryTx.deployed() as ProjectRegistryV1
    log("ProjectRegistry deployed at: ", projectRegistry.address)

    const streamRegistryFactory = await getContractFactory("StreamRegistryV5", deployerWallet)
    const streamRegistryFactoryTx = await streamRegistryFactory.attach(STREAM_REGISTRY_ADDRESS)
    streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV5
    log("StreamRegistryV5 deployed at: ", streamRegistry.address)

    const marketplaceV4Factory = await getContractFactory("MarketplaceV4", deployerWallet)
    const marketplaceV4FactoryTx = await marketplaceV4Factory.attach(MARKETPLACE_ADDRESS)
    marketplace = await marketplaceV4FactoryTx.deployed() as MarketplaceV4
    log("MarketplaceV4 deployed at: ", marketplace.address)

    const projectStakingFactory = await getContractFactory("ProjectStakingV1")
    const projectStakingFactoryTx = await projectStakingFactory.attach(PROJECT_STAKING_ADDRESS)
    projectStaking = await projectStakingFactoryTx.deployed() as ProjectStakingV1
    log("ProjectStakingV1 deployed at: ", projectStaking.address)

    const latestBlock = await hardhatEthers.provider.getBlock("latest")
    log('latestBlock', latestBlock.number)
}

const buyProject = async (
    projectId: string,
    subscriptionSeconds: number,
    buyer: Wallet
): Promise<void> => {
    let tx
    if(buyer) {
        log('   - buyer: ', buyer.address)
        tx = await marketplace.connect(buyer).buy(projectId, subscriptionSeconds)
    } else {
        tx = await marketplace.buy(projectId, subscriptionSeconds) // uses the cli exported KEY
    }
    log('   - subscriptionSeconds: ', subscriptionSeconds)
    log('   - projectId: ', projectId)
    await tx.wait()
}

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
    log(`CHAIN: ${CHAIN}, REMOTE_CHAIN: ${REMOTE_CHAIN}`)
    connectWallets()
    await connectContracts()

    updatePaymentDetails(8997, adminWallet.address, linkToken.address, 2) // dev1

    const streamId1 = await createStream()
    const projectId = await createProject({streams: [streamId1]})
    await updateProject({ id: projectId, streams: [], minimumSubscriptionSeconds: 2 })

    await setPermission({ projectId }) // defaults to a random address
    await grantSubscription({ projectId }) // defaults to a random address

    const streamId2 = await createStream()
    await addStream(projectId, streamId2)
    await removeStream(projectId, streamId2)

    await deleteProject(projectId)

    // const projectId = '0x0000000000000000000000000000000000000000000000000000000000000001'
    // console.log(`Subscription admin: ${await projectRegistry.getSubscription(projectId, adminWallet.address)}`)
    // console.log(`Subscription deployer: ${await projectRegistry.getSubscription(projectId,deployerWallet.address)}`)
    // console.log(`Subscription buyer: ${await projectRegistry.getSubscription(projectId, buyerWallet.address)}`)

    // MarketplaceV4
    // await(await marketplace.addMailbox(chainToMailboxAddress(CHAIN))).wait()
    // await(await marketplace.addRemoteMarketplace(chainToDomainId(REMOTE_CHAIN), REMOTE_MARKETPLACE_ADDRESS)).wait()
    // log('Marketplace state variables:')
    // log('   - chainId', await marketplace.chainId())
    // log('   - mailbox', await marketplace.mailbox())
    // log(`   - remoteMarketplaces(${REMOTE_CHAIN})`, await marketplace.remoteMarketplaces(chainToDomainId(REMOTE_CHAIN)))
    // const purchaseInfo = await marketplace.getPurchaseInfo(projectId, 100, 8997, 1) // projectId, subscriptionSeconds, chainId, purchaseId
    // log(`Purchase info: ${purchaseInfo}`)
    log(`Buyer can buy project: ${await projectRegistry.canBuyProject(projectId, buyerWallet.address)}`)
    await(await linkToken.connect(buyerWallet).approve(marketplace.address, 200)).wait()
    log(`Buyer subscription before buy: ${await projectRegistry.getSubscription(projectId, buyerWallet.address)}`)
    await buyProject(projectId, 100, buyerWallet)
    log(`Buyer subscription after buy: ${await projectRegistry.getSubscription(projectId, buyerWallet.address)}`)

    // ProjectStakingV1
    await(await linkToken.connect(buyerWallet).approve(projectStaking.address, 200)).wait()
    log(`Stake before staking: ${await projectStaking.getTotalStake()}`)
    await(await projectStaking.connect(buyerWallet).stake(projectId, 200)).wait()
    log(`Stake after staking: ${await projectStaking.getTotalStake()}`)

    log(`Stake before unstaking: ${await projectStaking.getTotalStake()}`)
    log(`Project stake before unstaking: ${await projectStaking.getProjectStake(projectId)}`)
    log(`User stake before unstaking: ${await projectStaking.getUserStake(buyerWallet.address)}`)
    await(await projectStaking.connect(buyerWallet).unstake(projectId, 200)).wait()
    log(`Stake after unstaking: ${await projectStaking.getTotalStake()}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
