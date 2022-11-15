import { IMarketplace } from "../typechain/IMarketplace"
import IMarketplaceJson from "../artifacts/contracts/IMarketplace.sol/IMarketplace.json"

import { Chains } from "@streamr-contracts/config"
import { Contract, providers } from "ethers"

const { log } = console

const {
    ethereum: {
        rpcEndpoints: [{
            url: rpcUrl,
        }],
        contracts: {
            "Marketplace": marketplaceAddress
        }
    }
} = Chains.load("development")

const provider = new providers.JsonRpcProvider(rpcUrl)

async function start() {
    const market = new Contract(marketplaceAddress, IMarketplaceJson.abi, provider) as IMarketplace
    const productId = "0x0000000000000000000000000000000000000000000000000000000000000001"
    market.on(market.filters.Subscribed(productId), (productId, subscriber, endTimestamp) => {
        log("Found subscription to %s by %s ending at %s", productId, subscriber, endTimestamp.toString())
    })
}
start().catch(console.error)
