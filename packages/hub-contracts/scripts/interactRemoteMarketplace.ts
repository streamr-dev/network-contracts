import { ethers as hardhatEthers } from "hardhat"
import { Wallet, providers } from "ethers"
import { Chains } from "@streamr/config"
import { RemoteMarketplace } from "../typechain/RemoteMarketplace"
import { chainToBlockExplorer, chainToEthereumRpcUrl } from "../utils"

const { getContractFactory } = hardhatEthers
// export const log = (..._: unknown[]): void => { /* skip logging */ }
const { log } = console

const {
    ORIGIN_CHAIN = 'goerli', // where RemoteMarketplace is deployed
    KEY: PROJECT_ADMIN_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // dummy key
    BUYER: PROJECT_BUYER_KEY = '0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb', // dummy key
    OTHER: OTHER_USER_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0', // dummy key
} = process.env

const {
    contracts: {
        RemoteMarketplace: REMOTE_MARKETPLACE_ADDRESS,
        LINK: LINK_TOKEN_ADDRESS,
    }
} = Chains.load()[ORIGIN_CHAIN]
// const LINK_TOKEN_ADDRESS = '0x326C977E6efc84E512bB9C30f76E30c160eD06FB' // mumbai
// const REMOTE_MARKETPLACE_ADDRESS = "" // goerli => must send some ETH to this address; contract pays for interchain gas fees

const blockExplorer: string = chainToBlockExplorer(ORIGIN_CHAIN)
const originRpcUrl: string = chainToEthereumRpcUrl(ORIGIN_CHAIN)

let remoteMarketplace: RemoteMarketplace
let admin: Wallet
let buyer: Wallet
let other: Wallet
let linkToken: any

const connectWallets = () => {
    log('Connecting wallets...')
    log('   - originRpcUrl', originRpcUrl)
    const provider = new providers.JsonRpcProvider(originRpcUrl)
    admin = new Wallet(PROJECT_ADMIN_KEY, provider)
    log('   - admin.address', admin.address)
    buyer = new Wallet(PROJECT_BUYER_KEY, provider)
    log('   - buyer.address', buyer.address)
    other = new Wallet(OTHER_USER_KEY, provider)
    log('   - other.address', other.address)
}

const connectContracts = async () => {
    const linkTokenFactory = await getContractFactory("DATAv2", admin) // used DATAv2 contract interface for common ERC20 functions
    const linkTokenFactoryTx = await linkTokenFactory.attach(LINK_TOKEN_ADDRESS)
    linkToken = await linkTokenFactoryTx.deployed()
    log("LinkToken deployed at: ", linkToken.address)
    log("LinkToken balance buyer: ", await linkToken.balanceOf(admin.address))

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
    buyer: Wallet = admin,
): Promise<void> => {
    let tx
    log('Buy project:')
    if(buyer) {
        log('   - buyer: ', buyer.address)
        tx = await remoteMarketplace.connect(buyer).buy(projectId, subscriptionSeconds)
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
 * npx hardhat run --network goerli scripts/interactRemoteMarketplace.ts
 * npx hardhat flatten contracts/RemoteMarketplace.sol > rm.sol
 */
async function main() {
    connectWallets()
    await connectContracts()

    log('Remote marketplace state variables:')
    log('   - originDomainId', await remoteMarketplace.originDomainId());
    log('   - destinationDomainId', await remoteMarketplace.destinationDomainId());
    log('   - recipientAddress', await remoteMarketplace.recipientAddress());
    log('   - mailbox address', await remoteMarketplace.mailbox());
    log('   - queryRouter address', await remoteMarketplace.queryRouter());
    log('   - gasPaymaster address', await remoteMarketplace.gasPaymaster());

    const existingProjectId = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const subscriptionSeconds = 100
    const pricePerToken = 1

    log('Remote marketplace balance before buy: %s', (await hardhatEthers.provider.getBalance(REMOTE_MARKETPLACE_ADDRESS)).toString())
    await linkToken.connect(admin).approve(remoteMarketplace.address, subscriptionSeconds * pricePerToken)
    await buy(existingProjectId, subscriptionSeconds, admin)
    log('Remote marketplace balance before buy: %s', (await hardhatEthers.provider.getBalance(REMOTE_MARKETPLACE_ADDRESS)).toString())
    
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
