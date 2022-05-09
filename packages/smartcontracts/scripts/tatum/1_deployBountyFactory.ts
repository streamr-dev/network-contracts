import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from 'ethers'
import hhat from 'hardhat'

// import { BountyFactory } from '../../typechain/BountyFactory'

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
const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'
const LINKTOKEN_ADDRESS = '0x3387F44140ea19100232873a5aAf9E46608c791E' // localchain
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
const log = require('debug')('streamr:eth-init')

let wallet: Wallet

async function deployBountyFactory() {
    const agreementTemplateFactory = await ethers.getContractFactory('Bounty')
    const agreementTemplate = await agreementTemplateFactory.deploy()
    await agreementTemplate.deployed()
    log(`BountyTemplate deployed at ${agreementTemplate.address}`)

    const bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', wallet)
    const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
        [ agreementTemplate.address, trustedForwarderAddress, LINKTOKEN_ADDRESS ])
    const bountyFactory = await bountyFactoryFactoryTx.deployed()// as BountyFactory
    log(`BountyFactory deployed at ${bountyFactory.address}`)
}

async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    log(`wallet address ${wallet.address}`)

    await deployBountyFactory()
}

main()
