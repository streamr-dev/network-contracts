import { ethers as hardhatEthers } from "hardhat"
import { Wallet, providers } from "ethers"
import { Chains } from "@streamr/config"
import { MarketplaceV4 } from "../typechain"
import { RemoteMarketplace } from "../typechain/RemoteMarketplace"

const { getContractFactory } = hardhatEthers
const { log } = console

const {
    DESTINATION_CHAIN = 'polygon',
    ORIGIN_CHAIN = 'gnosis',
    BUYER: PROJECT_BUYER_KEY = '0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb', // dummy key
    OTHER: OTHER_USER_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // dummy key
} = process.env

const {
    contracts: {
        MarketplaceV4: MARKETPLACE_ADDRESS,
    }
} = Chains.load()[DESTINATION_CHAIN]

const {
    rpcEndpoints: [{
        url: ORIGIN_RPC_URL
    }],
    contracts: {
        RemoteMarketplace: REMOTE_MARKETPLACE_ADDRESS,
    }
} = Chains.load()[ORIGIN_CHAIN]

if (!MARKETPLACE_ADDRESS) { throw new Error(`No MarketplaceV4 found in chain "${DESTINATION_CHAIN}"`) }
if (!REMOTE_MARKETPLACE_ADDRESS) { throw new Error(`No RemoteMarketplace found in chain "${ORIGIN_CHAIN}"`) }

let blockExplorer: string
switch (ORIGIN_CHAIN) {
    case 'gnosis':
        blockExplorer = 'https://gnosisscan.io'
        break
    default:
        blockExplorer = 'https://polygonscan.com'
        break
}

let marketplace: MarketplaceV4
let remoteMarketplace: RemoteMarketplace
let buyer: Wallet
let other: Wallet

const connectWallets = () => {
    const provider = new providers.JsonRpcProvider(ORIGIN_RPC_URL)
    buyer = new Wallet(PROJECT_BUYER_KEY, provider)
    other = new Wallet(OTHER_USER_KEY, provider)
}

const connectContracts = async () => {
    const marketplaceV4Factory = await getContractFactory("MarketplaceV4")
    const marketplaceV4FactoryTx = await marketplaceV4Factory.attach(MARKETPLACE_ADDRESS)
    marketplace = await marketplaceV4FactoryTx.deployed() as MarketplaceV4
    log("MarketplaceV4 deployed at: ", marketplace.address)

    const remoteMarketplaceFactory = await getContractFactory("RemoteMarketplace")
    const remoteMarketplaceFactoryTx = await remoteMarketplaceFactory.attach(REMOTE_MARKETPLACE_ADDRESS)
    remoteMarketplace = await remoteMarketplaceFactoryTx.deployed() as RemoteMarketplace
    log("RemoteMarketplace deployed at: ", remoteMarketplace.address)

    const latestBlock = await hardhatEthers.provider.getBlock("latest")
    log('latestBlock', latestBlock.number)
}

const buy = async (
    projectId: string,
    subscriptionSeconds: number,
    buyer: Wallet,
): Promise<void> => {
    const tx = await remoteMarketplace.connect(buyer).buy(projectId, subscriptionSeconds)
    log(`Buy project tx: ${blockExplorer}/tx/${tx.hash}`)
    await tx.wait()
}

const buyFor = async (
    projectId: string,
    subscriptionSeconds: number,
    buyer: Wallet,
    subscriber: string,
): Promise<void> => {
    const tx = await remoteMarketplace.connect(buyer).buyFor(projectId, subscriptionSeconds, subscriber)
    log(`BuyFor project tx: ${blockExplorer}/tx/${tx.hash}`)
    await tx.wait()
}

/**
 * npx hardhat run --network dev1 scripts/interactRemoteMarketplace.ts
 */
async function main() {
    connectWallets()
    await connectContracts()
    const existingProjectId = '0x0000000000000000000000000000000000000000000000000000000000000001'
    await buy(existingProjectId, 100, buyer)
    await buyFor(existingProjectId, 101, buyer, other.address)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
