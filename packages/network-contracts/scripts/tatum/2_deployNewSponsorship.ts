// first register ens domain on mainnet
// scripts/deploy.js

import { ethers } from "hardhat"
import { providers, Wallet } from "ethers"
import { Chains } from "@streamr/config"
import * as fs from "fs"
import { Sponsorship, SponsorshipFactory, LinkToken } from "../../typechain"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

const config = Chains.load()["dev1"]
const localConfig = JSON.parse(fs.readFileSync("localConfig.json", "utf8"))

const CHAINURL = config.rpcEndpoints[0].url

const chainProvider = new providers.JsonRpcProvider(CHAINURL)
let userWallet: Wallet
let sponsorshipFactory: SponsorshipFactory
let sponsorship: Sponsorship
let tokenFromOwner: LinkToken
let deploymentOwner: Wallet
let sponsorshipAddress: string

const connectToAllContracts = async () => {
    userWallet = Wallet.createRandom()
    deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)

    const sponsorshipFactoryFactory = await ethers.getContractFactory("SponsorshipFactory", { signer: deploymentOwner })
    const sponsorshipFactoryContact = await sponsorshipFactoryFactory.attach(localConfig.sponsorshipFactory) as SponsorshipFactory
    sponsorshipFactory = await sponsorshipFactoryContact.connect(deploymentOwner) as SponsorshipFactory

    // TODO: sponsorshipFactory should be using the DATA token from the config
    const linkTokenFactory = await ethers.getContractFactory("LinkToken", { signer: deploymentOwner })
    const linkTokenFactoryTx = await linkTokenFactory.attach(localConfig.token)
    const linkTokenContract = await linkTokenFactoryTx.deployed()
    tokenFromOwner = await linkTokenContract.connect(deploymentOwner) as LinkToken
}

const deployNewSponsorship = async () => {
    const sponsorshiptx = await sponsorshipFactory.deploySponsorship(ethers.utils.parseEther("60"), 0, 1, "Sponsorship-" + Date.now(), "metadata",
        [
            localConfig.allocationPolicy,
            ethers.constants.AddressZero,
            localConfig.voteKickPolicy,
        ], [
            ethers.utils.parseEther("0.01"),
            "0",
            "0"
        ]
    )
    const sponsorshipReceipt = await sponsorshiptx.wait()
    const newSponsorshipAddress = sponsorshipReceipt.events?.filter((e) => e.event === "NewSponsorship")[0]?.args?.sponsorshipContract
    log("new sponsorship address: " + newSponsorshipAddress)
    sponsorshipAddress = newSponsorshipAddress
}

const sponsorNewSponsorship = async () => {
    sponsorship = await ethers.getContractAt("Sponsorship", sponsorshipAddress, deploymentOwner) as Sponsorship
    // sponsor with token approval
    // const ownerbalance = await tokenFromOwner.balanceOf(deploymentOwner.address)
    await (await tokenFromOwner.approve(sponsorshipAddress, ethers.utils.parseEther("7"))).wait()
    // const allowance = await tokenFromOwner.allowance(deploymentOwner.address, sponsorshipAddress)
    const sponsorTx = await sponsorship.sponsor(ethers.utils.parseEther("7"))
    await sponsorTx.wait()
    log("sponsored through token approval")
}

const stakeOnSponsorship = async () => {
    const tx = await tokenFromOwner.transferAndCall(sponsorshipAddress, ethers.utils.parseEther("100"),
        userWallet.address)
    await tx.wait()
    log("staked in sponsorship with transfer and call")
}

// const updateMetadata = async () => {
//     const tx = await sponsorship.setMetadata("new metadata")
//     await tx.wait()
//     log("updated metadata")
// }

/** npx hardhat run --network dev1 scripts/tatum/2_deployNewSponsorship.ts */
async function main() {
    await connectToAllContracts()
    await deployNewSponsorship()
    await sponsorNewSponsorship()
    await stakeOnSponsorship()
    // await updateMetadata()
    localConfig.sponsorship = sponsorshipAddress
    fs.writeFileSync("localConfig.json", JSON.stringify(localConfig, null, 2))
    log("Wrote sponsorship address to local config")
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

