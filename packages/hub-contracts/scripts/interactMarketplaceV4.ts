import { ethers as hardhatEthers } from "hardhat"
import { utils, Wallet, providers, BigNumber } from "ethers"
import { Chains } from "@streamr/config"
import { DATAv2, MarketplaceV4, ProjectRegistry, StreamRegistryV3 } from "../typechain"
import { chainToDomainId } from "../utils"

const { getContractFactory } = hardhatEthers
const { hexlify, toUtf8Bytes, zeroPad } = utils
const { log } = console

const {
    ORIGIN_CHAIN = 'optGoerli', // where RemoteMarketplace is deployed
    DESTINATION_CHAIN = 'alfajores', // where ProjectRegistry & MarketplaceV4 is deployed
} = process.env

const {
    rpcEndpoints: [{
        url: ETHEREUM_RPC_URL
    }],
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

const buy = async (
    projectId: string,
    subscriptionSeconds: number,
    buyer = buyerWallet
): Promise<void> => {
    await (
        await marketplace.connect(buyer).buy(projectId, subscriptionSeconds)
    ).wait()
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
 * npx hardhat run --network alfajores scripts/interactMarketplaceV4.ts
 */
async function main() {
    await connectContracts()
    await addCrossChainMarketplace()
    // await addCrossChainInbox(inboxOptGoerliToAlfajores)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
