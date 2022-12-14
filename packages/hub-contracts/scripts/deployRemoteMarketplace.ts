import { ethers } from "hardhat"
import { Chains } from "@streamr/config"

const { log } = console

const {
    DESTINATION_CHAIN = 'polygon',
    DESTINATION_DOMAIN_ID = '0x706f6c79', // polygon
    ORIGIN_CHAIN = 'gnosis',
} = process.env

const {
    contracts: {
        MarketplaceV4: RECIPIENT_MARKETPLACE_ADDRESS,
    }
} = Chains.load()[DESTINATION_CHAIN]

const {
    contracts: {
        HyperlaneOutbox: OUTBOX_ADDRESS,
    }
} = Chains.load()[ORIGIN_CHAIN]

if (!RECIPIENT_MARKETPLACE_ADDRESS) { throw new Error(`No MarketplaceV4 found in chain "${DESTINATION_CHAIN}"`) }
if (!OUTBOX_ADDRESS) { throw new Error(`No HyperlaneOutbox found in chain "${ORIGIN_CHAIN}"`) }

/**
 * npx hardhat run --network dev1 scripts/deployRemoteMarketplace.ts
 */
async function main() { // messaging from RemoteMarketplace to MarketplaceV4
    const remoteMarketplaceFactory = await ethers.getContractFactory("RemoteMarketplace")
    const remoteMarketplace = await remoteMarketplaceFactory.deploy(
        DESTINATION_DOMAIN_ID,
        RECIPIENT_MARKETPLACE_ADDRESS,
        OUTBOX_ADDRESS, // Hyperlane Outbox address for the origin chain
    )
    await remoteMarketplace.deployed()
    log(`RemoteMarketplace deployed at ${remoteMarketplace.address}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
