// first register ens domain on mainnet
// scripts/deploy.js

import { ethers } from "hardhat"
import { providers, Wallet } from "ethers"
import { Chains } from "@streamr/config"
import * as fs from "fs"
import { Bounty, BountyFactory, LinkToken } from "../../typechain"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

const config = Chains.load()["dev1"]
const localConfig = JSON.parse(fs.readFileSync("localConfig.json", "utf8"))

const CHAINURL = config.rpcEndpoints[0].url

const chainProvider = new providers.JsonRpcProvider(CHAINURL)
let userWallet: Wallet
let bountyFactory: BountyFactory
let bounty: Bounty
let tokenFromOwner: LinkToken
let deploymentOwner: Wallet
let bountyAddress: string

const connectToAllContracts = async () => {
    userWallet = Wallet.createRandom()
    deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)

    const bountyFactoryFactory = await ethers.getContractFactory("BountyFactory", { signer: deploymentOwner })
    const bountyFactoryContact = await bountyFactoryFactory.attach(localConfig.bountyFactory) as BountyFactory
    bountyFactory = await bountyFactoryContact.connect(deploymentOwner) as BountyFactory

    const linkTokenFactory = await ethers.getContractFactory("LinkToken", { signer: deploymentOwner })
    const linkTokenFactoryTx = await linkTokenFactory.attach(localConfig.token)
    const linkTokenContract = await linkTokenFactoryTx.deployed()
    tokenFromOwner = await linkTokenContract.connect(deploymentOwner) as LinkToken
}

const deployNewBounty = async () => {
    const agreementtx = await bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + Date.now(),
        [
            localConfig.allocationPolicy,
            ethers.constants.AddressZero,
            ethers.constants.AddressZero,
        ], [
            ethers.utils.parseEther("0.01"),
            "0",
            "0"
        ]
    )
    const agreementReceipt = await agreementtx.wait()
    const newBountyAddress = agreementReceipt.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
    log("new bounty address: " + newBountyAddress)
    bountyAddress = newBountyAddress
}
    
const sponsorNewBounty = async () => {
    bounty = await ethers.getContractAt("Bounty", bountyAddress, deploymentOwner) as Bounty
    // sponsor with token approval
    // const ownerbalance = await tokenFromOwner.balanceOf(deploymentOwner.address)
    await (await tokenFromOwner.approve(bountyAddress, ethers.utils.parseEther("7"))).wait()
    // const allowance = await tokenFromOwner.allowance(deploymentOwner.address, bountyAddress)
    const sponsorTx = await bounty.sponsor(ethers.utils.parseEther("7"))
    await sponsorTx.wait()
    log("sponsored through token approval")
}

const stakeOnBounty = async () => {
    const tx = await tokenFromOwner.transferAndCall(bountyAddress, ethers.utils.parseEther("1"),
        userWallet.address)
    await tx.wait()
    log("staked in bounty with transfer and call")
}

async function main() {
    await connectToAllContracts()
    await deployNewBounty()
    await sponsorNewBounty()
    await stakeOnBounty()
    localConfig.bounty = bountyAddress
    fs.writeFileSync("localConfig.json", JSON.stringify(localConfig, null, 2))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

