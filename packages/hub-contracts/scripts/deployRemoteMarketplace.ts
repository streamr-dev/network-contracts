import { ethers, upgrades } from "hardhat"
import { config } from "@streamr/config"
import { chainToDomainId, chainToMailboxAddress, chainToDefaultPaymasterAddress, chainToQueryRouterAddress } from "../utils"

const { log } = console

const {
    REMOTE_CHAIN = 'goerli', // where RemoteMarketplace is deployed
    CHAIN = 'mumbai', // where ProjectRegistryV1 & MarketplaceV4 is deployed
} = process.env

const originDomainId: number = chainToDomainId(REMOTE_CHAIN)
const mailboxAddress: string = chainToMailboxAddress(REMOTE_CHAIN)
const destinationDomainId: number = chainToDomainId(CHAIN)
const interchainQueryRouterAddress: string = chainToQueryRouterAddress(REMOTE_CHAIN)
const interchainGasPaymasterAddress: string = chainToDefaultPaymasterAddress(REMOTE_CHAIN)

const {
    contracts: {
        MarketplaceV4: RECIPIENT_MARKETPLACE_ADDRESS,
    }
} = (config as any)[CHAIN]
if (!RECIPIENT_MARKETPLACE_ADDRESS) { throw new Error(`No MarketplaceV4 found in chain "${CHAIN}"`) }
// const RECIPIENT_MARKETPLACE_ADDRESS = ""

/**
 * npx hardhat run --network gnosis scripts/deployRemoteMarketplace.ts
 * npx hardhat flatten contracts/Marketplace/RemoteMarketplace.sol > rm.sol
 * npx hardhat verify --network dev0 --constructor-args scripts/argsRemoteMarketplace.js <contract-address>
 * e.g. argsRemoteMarketplace.js file: module.exports = [arg1, arg2, agr3]
 */
async function main() { // messaging from RemoteMarketplace to MarketplaceV4
    const remoteMarketplaceFactory = await ethers.getContractFactory("RemoteMarketplace")
    log(`Deploying RemoteMarketplace to ${REMOTE_CHAIN}:`)
    log(`   - origin domain id: ${originDomainId}`)
    log(`   - interchain query router for all chains: ${interchainQueryRouterAddress}`)
    log(`   - mailbox for all chains: ${mailboxAddress}`)
    log(`   - gas paymaster for all chains: ${interchainGasPaymasterAddress}`)
    const remoteMarketplace = await upgrades.deployProxy(remoteMarketplaceFactory, [
        originDomainId, // domain id of the chain this contract is deployed on
        interchainQueryRouterAddress, // Hyperlane InterchainQueryRouter address for origin chain (the same for all chains)
        mailboxAddress, // Hyperlane Mailbox address for origin chain (the same for all chains)
        interchainGasPaymasterAddress, // Hyperlane InterchainGasPaymaster address for origin chain (the same for all chains)
    ], { kind: 'uups' })
    await remoteMarketplace.deployed()
    log(`RemoteMarketplace deployed at ${remoteMarketplace.address}`)

    await(await remoteMarketplace.addRecipient(destinationDomainId, RECIPIENT_MARKETPLACE_ADDRESS)).wait()
    log(`   - destination chain: ${CHAIN}`)
    log(`   - set destination domain id: ${destinationDomainId}`)
    log(`   - set recipient marketplace (on destination chain): ${RECIPIENT_MARKETPLACE_ADDRESS}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
