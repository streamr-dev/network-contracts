import { ethers as hardhatEthers } from "hardhat"
import { Wallet } from "ethers"
import { Chains } from "@streamr/config"
import { MarketplaceV4 } from "../typechain"
import { chainToDomainId } from "../utils"

const { getContractFactory } = hardhatEthers
const { log } = console

const {
    ORIGIN_CHAIN = 'dev0', // where RemoteMarketplace is deployed
    DESTINATION_CHAIN = 'dev1', // where ProjectRegistryV1 & MarketplaceV4 is deployed
} = process.env

const {
    contracts: {
        MarketplaceV4: MARKETPLACE_V4_ADDRESS,
    }
} = Chains.load()[DESTINATION_CHAIN]

const {
    contracts: {
        RemoteMarketplace: REMOTE_MARKETPLACE_ADDRESS,
    }
} = Chains.load()[ORIGIN_CHAIN]

let marketplace: MarketplaceV4
let buyerWallet: Wallet
const originDomainId = chainToDomainId(ORIGIN_CHAIN)
const destinationDomainId = chainToDomainId(DESTINATION_CHAIN)
const originMarketplaceAddress = REMOTE_MARKETPLACE_ADDRESS
const inboxOptGoerliToAlfajores = "0x873B0085924096A2d52849A4F1B921C5aeE8Fb30" // opt-goerli to alfajores

const connectContracts = async () => {
    const marketplaceV4Factory = await getContractFactory("MarketplaceV4")
    const marketplaceV4FactoryTx = await marketplaceV4Factory.attach(MARKETPLACE_V4_ADDRESS)
    marketplace = await marketplaceV4FactoryTx.deployed() as MarketplaceV4
    log("MarketplaceV4 deployed at: ", marketplace.address)

    const latestBlock = await hardhatEthers.provider.getBlock("latest")
    log('latestBlock', latestBlock.number)
}

const buyProject = async (
    projectId: string,
    subscriptionSeconds: number,
    buyer = buyerWallet
): Promise<void> => {
    let tx
    if(buyer) {
        tx = await marketplace.connect(buyer).buy(projectId, subscriptionSeconds)
        log('   - buyer: ', buyer.address)
    } else {
        tx = await marketplace.buy(projectId, subscriptionSeconds) // uses the cli exported KEY
    }
    log('   - subscriptionSeconds: ', subscriptionSeconds)
    log('   - projectId: ', projectId)
    await tx.wait()
}

const addCrossChainMarketplace = async (
    _originDomainId: number = originDomainId,
    _originMarketplaceAddress: string = originMarketplaceAddress,
): Promise<void> => {
    await (
        await marketplace.addCrossChainMarketplace(originDomainId, originMarketplaceAddress)
    ).wait()
    log(`Added cross-chain marketplace ${originMarketplaceAddress} on domain ${originDomainId}`)
}

const addCrossChainInbox = async (
    _inboxAddress: string,
    _originDomainId: number = originDomainId,
): Promise<void> => {
    await (
        await marketplace.addCrossChainInbox(originDomainId, _inboxAddress)
    ).wait()
    log(`Added cross-chain inbox origin=${originDomainId} destination=${destinationDomainId}: ${_inboxAddress}`)
}

/**
 * npx hardhat run --network dev1 scripts/interactMarketplaceV4.ts
 */
async function main() {
    await connectContracts()
    const isLivenet = true
    
    if (isLivenet) {
        await addCrossChainMarketplace()
        await addCrossChainInbox(inboxOptGoerliToAlfajores)
        const freeProject = "0x0000000000000000000000000000000000000000000000000000000000000001"
        await buyProject(freeProject, 100)
        const paidProject = "0x0000000000000000000000000000000000000000000000000000000000000002"
        await buyProject(paidProject, 100)
    } else {
        // not deplyed to local env
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
