import { ethers } from "hardhat"
import { Chains } from "@streamr/config"
import { chainToDomainId, chainToOutboxAddress, queryRouterAddressTestchain } from "../utils"

const { log } = console

const {
    ORIGIN_CHAIN = 'dev0', // where RemoteMarketplace is deployed
    DESTINATION_CHAIN = 'dev1', // where ProjectRegistry & MarketplaceV4 is deployed
} = process.env

const originDomainId: number = chainToDomainId(ORIGIN_CHAIN)
const outboxAddress: string = chainToOutboxAddress(ORIGIN_CHAIN)
const destinationDomainId: number = chainToDomainId(DESTINATION_CHAIN)
const interchainQueryRouterAddress: string = queryRouterAddressTestchain

const {
    contracts: {
        MarketplaceV4: RECIPIENT_MARKETPLACE_ADDRESS,
    }
} = Chains.load()[DESTINATION_CHAIN]

if (!RECIPIENT_MARKETPLACE_ADDRESS) { throw new Error(`No MarketplaceV4 found in chain "${DESTINATION_CHAIN}"`) }

/**
 * npx hardhat run --network dev0 scripts/deployRemoteMarketplace.ts
 * npx hardhat flatten contracts/RemoteMarketplace.sol > rm.sol
 * npx hardhat verify --network dev0 --constructor-args scripts/argsRemoteMarketplace.js <contract-address>
 * e.g. argsRemoteMarketplace.js file: module.exports = [arg1, arg2, agr3]
 */
async function main() { // messaging from RemoteMarketplace to MarketplaceV4
    const remoteMarketplaceFactory = await ethers.getContractFactory("RemoteMarketplace")
    log(`Deploying RemoteMarketplace to ${ORIGIN_CHAIN}:`)
    log(`   - origin domain id: ${originDomainId}`)
    log(`   - interchain query router for all chains: ${interchainQueryRouterAddress}`)
    log(`   - outbox for origin chain: ${outboxAddress}`)
    const remoteMarketplace = await remoteMarketplaceFactory.deploy(
        originDomainId, // domain id of the chain this contract is deployed on
        interchainQueryRouterAddress, // Hyperlane InterchainQueryRouter address for origin chain (it's the same for all testchains/mainchains)
        outboxAddress, // Hyperlane Outbox address for the origin chain
    )
    await remoteMarketplace.deployed()
    log(`RemoteMarketplace deployed at ${remoteMarketplace.address}`)

    await(await remoteMarketplace.addRecipient(destinationDomainId, RECIPIENT_MARKETPLACE_ADDRESS)).wait()
    log(`   - destination chain: ${DESTINATION_CHAIN}`)
    log(`   - set destination domain id: ${destinationDomainId}`)
    log(`   - set recipient marketplace (on destination chain): ${RECIPIENT_MARKETPLACE_ADDRESS}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
