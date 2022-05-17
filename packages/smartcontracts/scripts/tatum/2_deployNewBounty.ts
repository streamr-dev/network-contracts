// first register ens domain on mainnet
// scripts/deploy.js

import { ethers, upgrades } from 'hardhat'
import { BigNumber, Contract, providers, utils, Wallet } from 'ethers'

import { Bounty, BountyFactory, LinkToken } from '../../typechain'
import { defaultAbiCoder } from 'ethers/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require('debug')('streamr:deploy-tatum')
// const { ethers } = hhat
// const resolverAbi = require('@ensdomains/resolver/build/contracts/PublicResolver.json')

// hardhat
// const DEFAULTPRIVATEKEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // hardhat
// const SIDECHAINURL = 'http://localhost:8545'
// const MAINNETURL = 'http://localhost:8545'
// const LINKTOKEN = '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1'
// const DEPLOYMENT_OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// localsidechain
const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const CHAINURL = 'http://localhost:8546'
const LINKTOKEN = '0x3387F44140ea19100232873a5aAf9E46608c791E'
const DEPLOYMENT_OWNER_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'

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
const BOUNTYFACTORY = '0xDa7893ee6Ab31413ea734dd0B7c259eeD290bF2a'
const ALLOCATIONPOLICY = '0x699B4bE95614f017Bb622e427d3232837Cc814E6'
let bountyAddress = "0x46d62a056966e61256f499ef9d1bea32db45ebb2"

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
// let resolverFomAdmin : Contract

const connectToAllContracts = async () => {
    userWallet = new Wallet(DEFAULTPRIVATEKEY, chainProvider)
    adminWallet = new Wallet(DEPLOYMENT_OWNER_KEY, chainProvider)

    const bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', adminWallet)
    const bountyFactoryContact = await bountyFactoryFactory.attach(BOUNTYFACTORY) as BountyFactory
    // bountyFactory = await bountyFactoryContact.deployed()
    bountyFactory = await bountyFactoryContact.connect(adminWallet) as BountyFactory
    // registryFromOwner = await registryContract.connect(deploymentOwner) as StreamRegistry

    const deploymentOwner = new Wallet(DEPLOYMENT_OWNER_KEY, chainProvider)
    const linkTokenFactory = await ethers.getContractFactory('LinkToken', adminWallet)
    const linkTokenFactoryTx = await linkTokenFactory.attach(LINKTOKEN)
    const linkTokenContract = await linkTokenFactoryTx.deployed()
    tokenFromOwner = await linkTokenContract.connect(deploymentOwner) as LinkToken

}

const deployNewBounty = async () => {
    const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty-" + Date.now())
    const agreementReceipt = await agreementtx.wait()
    const newBountyAddress = agreementReceipt.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
    log("new bounty address: " + newBountyAddress)
    bounty = await ethers.getContractAt('Bounty', newBountyAddress, adminWallet) as Bounty
    bountyAddress = bounty.address
    await (await bounty.setAllocationPolicy(ALLOCATIONPOLICY, ethers.BigNumber.from('1'))).wait() // 3 -> will throw on leave
    log("bounty deployed, alloctionpolicy set")
    // sponsor with token approval
    await (await tokenFromOwner.approve(bounty.address, ethers.BigNumber.from('10'))).wait()
    const sponsorTx = await bounty.sponsor(ethers.BigNumber.from('1'))
    const sponsorReceipt = await sponsorTx.wait()
    log("sponsoded through token approval")
    // log("sponsor tx: " + JSON.stringify(sponsorReceipt))
    const sponsorTx2 = await tokenFromOwner.transferAndCall(bountyAddress, ethers.utils.parseEther("1"),
        "0x")
    const sponsorReceipt2 = await sponsorTx2.wait()
    log("sponsored through token transfer and call")
    // log("sponsor tx2: " + JSON.stringify(sponsorReceipt2))

}

const joinBounty = async () => {
    // const tx = await tokenFromOwner.transferAndCall(bountyAddress, ethers.utils.parseEther('2'), userWallet.address)
    const tx = await tokenFromOwner.transferAndCall(bountyAddress, ethers.utils.parseEther("1"),
        defaultAbiCoder.encode(["address"], [userWallet.address]))
    const receipt = await tx.wait()
    const OnTTEvent = receipt.events?.filter((e) => e.event === "OnTT")[0]
    log("staked in bounty with transfer and call")
    // log("token transfer and call" + JSON.stringify(receipt))
}

async function main() {
    await connectToAllContracts()
    // await deployNewBounty()
    await joinBounty()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

