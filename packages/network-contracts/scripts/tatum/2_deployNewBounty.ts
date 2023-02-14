// first register ens domain on mainnet
// scripts/deploy.js

import { ethers } from "hardhat"
import { providers, Wallet } from "ethers"
import { Chains } from "@streamr/config"

import { Bounty, BountyFactory, LinkToken } from "../../typechain"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

const config = Chains.load("development").streamr
// hardhat
// const DEFAULTPRIVATEKEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // hardhat
// const SIDECHAINURL = 'http://localhost:8545'
// const MAINNETURL = 'http://localhost:8545'
// const LINKTOKEN = '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1'
// const DEPLOYMENT_OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// localsidechain
// const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const CHAINURL = config.rpcEndpoints[0].url
const LINKTOKEN = config.contracts.LinkToken
const DEPLOYMENT_OWNER_KEY = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

// mumbai
// const DEFAULTPRIVATEKEY = process.env.OCR_USER_PRIVATEKEY || ''
// const MAINNETURL = 'http://localhost:8545'
// const SIDECHAINURL = 'https://rpc-mumbai.maticvigil.com'
// const LINKTOKEN = '0x326C977E6efc84E512bB9C30f76E30c160eD06FB'
// const DEPLOYMENT_OWNER_KEY = process.env.OCR_ADMIN_PRIVATEKEY || ''

// Polygon mainet
// const DEFAULTPRIVATEKEY = process.env.OCR_USER_PRIVATEKEY || ''
// const MAINNETURL = 'http://localhost:8545'
// const SIDECHAINURL = 'https://polygon-rpc.com'
// const LINKTOKEN = '0xb0897686c545045afc77cf20ec7a532e3120e0f1'
// const DEPLOYMENT_OWNER_KEY = process.env.OCR_ADMIN_PRIVATEKEY || ''

// ADDRESSES

// const ORACLEADDRESS = '0x382b486B81FefB1F280166f2000a53b961b9840d'
// const ENSCACHEADDRESS = '0x36c64EE95d9D6735f8841aB157Bd8fEE35aab28b'
// const STREAMREGISTRYADDRESS = '0x720daa1337B50DF384C3AcFa037A98D533059d0d'
// const CHAINLINK_JOBID = '020f92986c5840debdcbd99d607602d2' // https://github.com/streamr-dev/smart-contracts-init#running
// const CHAINLINK_NODE_ADDRESS = '0x7b5F1610920d5BAf00D684929272213BaF962eFe'

// addresses localsidechain
// const BOUNTYTEMPLATE = '0xed323f85CAA93EBAe223aAee449919105C1a71A0'
// const BOUNTYFACTORY = '0xA90CeCcA042312b8f2e8B924C04Ce62516CBF7b2'
const BOUNTYFACTORY = config.contracts.BountyFactory
// const ALLOCATIONPOLICY = '0x3C841B9Aa08166e9B864972930703e878d25804B'
const ALLOCATIONPOLICY = config.contracts.AllocationPolicyTemplate
// will be overwritten when deployNewBounty is called
let bountyAddress = "0xcb41f39b991a8739d4f92b171605c669472f2abc"

// Polygon mainet contract addresses
// const ORACLEADDRESS = '0x36BF71D0ba2e449fc14f9C4cF51468948E4ED27D'
// const ENSCACHEADDRESS = '0x870528c1aDe8f5eB4676AA2d15FC0B034E276A1A'
// const STREAMREGISTRYADDRESS = '0x0D483E10612F327FC11965Fc82E90dC19b141641'
// const CHAINLINK_JOBID = '13c04b52ce0c4716bb629a872c99b153' // https://github.com/streamr-dev/smart-contracts-init#running
// const CHAINLINK_NODE_ADDRESS = '0xc244dA783A3B96f4D420A4eEfb105CD0Db4bE01a'

const chainProvider = new providers.JsonRpcProvider(CHAINURL)
let userWallet: Wallet
let adminWallet: Wallet
let bountyFactory: BountyFactory
let bounty: Bounty
let tokenFromOwner: LinkToken
let deploymentOwner: Wallet

const connectToAllContracts = async () => {
    // userWallet = new Wallet(DEFAULTPRIVATEKEY, chainProvider)
    userWallet = Wallet.createRandom()
    adminWallet = new Wallet(DEPLOYMENT_OWNER_KEY, chainProvider)

    const bountyFactoryFactory = await ethers.getContractFactory("BountyFactory", adminWallet)
    const bountyFactoryContact = await bountyFactoryFactory.attach(BOUNTYFACTORY) as BountyFactory
    bountyFactory = await bountyFactoryContact.connect(adminWallet) as BountyFactory

    deploymentOwner = new Wallet(DEPLOYMENT_OWNER_KEY, chainProvider)
    const linkTokenFactory = await ethers.getContractFactory("LinkToken", adminWallet)
    const linkTokenFactoryTx = await linkTokenFactory.attach(LINKTOKEN)
    const linkTokenContract = await linkTokenFactoryTx.deployed()
    tokenFromOwner = await linkTokenContract.connect(deploymentOwner) as LinkToken
}

const deployNewBounty = async () => {
    const agreementtx = await bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + Date.now(),
        [
            ALLOCATIONPOLICY,
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
    bounty = await ethers.getContractAt("Bounty", bountyAddress, adminWallet) as Bounty
    // sponsor with token approval
    await tokenFromOwner.balanceOf(deploymentOwner.address)
    await (await tokenFromOwner.approve(bountyAddress, ethers.utils.parseEther("7"))).wait()
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
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

