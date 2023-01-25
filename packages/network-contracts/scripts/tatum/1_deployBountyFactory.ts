import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from 'ethers'
import { Chains } from "@streamr/config"
import hhat from 'hardhat'
import { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, ILeavePolicy, StreamrConstants, TestToken } from '../../typechain'

// import { BountyFactory } from '../../typechain/BountyFactory'
const config = Chains.load()['dev1']

const { ethers, upgrades } = hhat

// const NodeRegistry = require('./ethereumContractJSONs/NodeRegistry.json')

// const ENSRegistry = require('./ethereumContractJSONs/ENSRegistry.json')
// const FIFSRegistrar = require('./ethereumContractJSONs/FIFSRegistrar.json')
// const PublicResolver = require('./ethereumContractJSONs/PublicResolver.json')

// Streamregistry
// const LinkToken = require('./ethereumContractJSONs/LinkToken.json')
// const ChainlinkOracle = require('./ethereumContractJSONs/Oracle.json')
// const ENSCache = require('./ethereumContractJSONs/ENSCache.json')
// const StreamRegistry = require('./ethereumContractJSONs/StreamRegistry.json')
// const StreamStorageRegistry = require('./ethereumContractJSONs/StreamStorageRegistry.json')

// localsidechain
const chainURL = config.rpcEndpoints[0].url
const privKeyStreamRegistry = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'
const LINKTOKEN_ADDRESS = config.contracts.LinkToken // localchain
const trustedForwarderAddress = '0x2fb7Cd141026fcF23Abb07593A14D6E45dC33D54' // some random address

// hardhat
// const chainURL = 'http://127.0.0.1:8545'
// const privKeyStreamRegistry = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // hardhat
// let LINKTOKEN_ADDRESS = ''

// mumbai
// const chainURL = 'https://matic-mumbai.chainstacklabs.com/'
// const chainURL = 'https://rpc-mumbai.maticvigil.com'
// const LINKTOKEN_ADDRESS = '0x326C977E6efc84E512bB9C30f76E30c160eD06FB' // mumbai
// const privKeyStreamRegistry = process.env.OCR_ADMIN_PRIVATEKEY || '' // also set DEBUG="*"

// Polygon mainnet
// const chainURL = 'https://polygon-rpc.com'
// const LINKTOKEN_ADDRESS = '0xb0897686c545045afc77cf20ec7a532e3120e0f1' // mumbai
// const privKeyStreamRegistry = process.env.OCR_ADMIN_PRIVATEKEY || '' // also set DEBUG="*"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require('debug')('streamr:deploy-tatum')

let adminWallet: Wallet
let brokerWallet: Wallet

async function deployBountyFactory() {
    const streamrConstants = await (await ethers.getContractFactory("StreamrConstants", adminWallet)).deploy() as StreamrConstants
    await streamrConstants.deployed()
    log(`streamrConstants address ${streamrConstants.address}`)

    const token = await (await ethers.getContractFactory("TestToken", adminWallet)).deploy("Test token", "TEST") as TestToken
    await token.deployed()
    log(`token address ${token.address}`)

    const minStakeJoinPolicy = await (await ethers.getContractFactory("MinimumStakeJoinPolicy", adminWallet)).deploy() as IJoinPolicy
    await minStakeJoinPolicy.deployed()
    log(`minStakeJoinPolicy address ${minStakeJoinPolicy.address}`)

    const maxBrokersJoinPolicy = await (await ethers.getContractFactory("MaxAmountBrokersJoinPolicy", adminWallet)).deploy() as IJoinPolicy
    await maxBrokersJoinPolicy.deployed()
    log(`maxBrokersJoinPolicy address ${maxBrokersJoinPolicy.address}`)

    const allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy", adminWallet)).deploy() as IAllocationPolicy
    await allocationPolicy.deployed()
    log(`allocationPolicy address ${allocationPolicy.address}`)

    const leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy", adminWallet)).deploy() as ILeavePolicy
    await leavePolicy.deployed()
    log(`leavePolicy address ${leavePolicy.address}`)

    const bountyTemplate = await (await ethers.getContractFactory("Bounty")).deploy() as Bounty
    await bountyTemplate.deployed()
    log(`bountyTemplate address ${bountyTemplate.address}`)

    const bountyFactoryFactory = await ethers.getContractFactory("BountyFactory", adminWallet)
    const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
        [ bountyTemplate.address, token.address, streamrConstants.address ])
    const bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
    await (await bountyFactory.addTrustedPolicies([minStakeJoinPolicy.address, maxBrokersJoinPolicy.address,
        allocationPolicy.address, leavePolicy.address])).wait()
    log(`bountyFactory address ${bountyFactory.address}`)

    await (await token.mint(adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
    log(`minted 1000000 tokens to ${adminWallet.address}`)
    await (await token.mint(brokerWallet.address, ethers.utils.parseEther("100000"))).wait()
    log(`transferred 100000 tokens to ${brokerWallet.address}`)
    await (await adminWallet.sendTransaction({ to: brokerWallet.address, value: ethers.utils.parseEther("1") })).wait()
    log(`transferred 1 ETH to ${brokerWallet.address}`)
}

async function main() {
    adminWallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    brokerWallet = ethers.Wallet.createRandom().connect(new JsonRpcProvider(chainURL))
    log(`wallet address ${adminWallet.address}`)

    await deployBountyFactory()
}

main()
