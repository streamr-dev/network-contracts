import { ethers as hardhatEthers } from "hardhat"
import { Wallet, providers } from "ethers"
import { Chains } from "@streamr/config"
import { RemoteMarketplace } from "../typechain/RemoteMarketplace"
import { chainToBlockExplorer, chainToEthereumRpcUrl } from "../utils"

const { getContractFactory } = hardhatEthers
const { log } = console

const {
    ORIGIN_CHAIN = 'optGoerli', // where RemoteMarketplace is deployed
    BUYER: PROJECT_BUYER_KEY = '0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb', // dummy key
    OTHER: OTHER_USER_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // dummy key
} = process.env

const {
    contracts: {
        RemoteMarketplace: REMOTE_MARKETPLACE_ADDRESS,
    }
} = Chains.load()[ORIGIN_CHAIN]

const blockExplorer: string = chainToBlockExplorer(ORIGIN_CHAIN)
const originRpcUrl: string = chainToEthereumRpcUrl(ORIGIN_CHAIN)

let remoteMarketplace: RemoteMarketplace
let buyer: Wallet
let other: Wallet

const connectWallets = () => {
    log('Connecting wallets...')
    log('   - originRpcUrl', originRpcUrl)
    const provider = new providers.JsonRpcProvider(originRpcUrl)
    buyer = new Wallet(PROJECT_BUYER_KEY, provider)
    log('   - buyer.address', buyer.address)
    other = new Wallet(OTHER_USER_KEY, provider)
    log('   - other.address', other.address)
}

const connectContracts = async () => {
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
    buyer?: Wallet,
): Promise<void> => {
    let tx
    log('Buy project:')
    if(buyer) {
        tx = await remoteMarketplace.connect(buyer).buy(projectId, subscriptionSeconds)
        log('   - buyer: ', buyer.address)
    } else {
        tx = await remoteMarketplace.buy(projectId, subscriptionSeconds) // uses the cli exported KEY
    }
    log(`   - tx: ${blockExplorer}/tx/${tx.hash}`)
    log('   - subscriptionSeconds: ', subscriptionSeconds)
    log('   - projectId: ', projectId)
    await tx.wait()
}

// const buyFor = async (
//     projectId: string,
//     subscriptionSeconds: number,
//     buyer: Wallet,
//     subscriber: string,
// ): Promise<void> => {
//     const tx = await remoteMarketplace.connect(buyer).buyFor(projectId, subscriptionSeconds, subscriber)
//     log(`BuyFor project tx: ${blockExplorer}/tx/${tx.hash}`)
//     await tx.wait()
// }

/**
 * npx hardhat run --network optGoerli scripts/interactRemoteMarketplace.ts
 * npx hardhat flatten contracts/RemoteMarketplace.sol > rm.sol
 */
async function main() {
    connectWallets()
    await connectContracts()
    const existingProjectId = '0x0000000000000000000000000000000000000000000000000000000000000001'
    await buy(existingProjectId, 205)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
