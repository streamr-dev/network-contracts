import { JsonRpcProvider } from '@ethersproject/providers'
import { constants, Wallet } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import hhat from 'hardhat'

import { StreamRegistry } from '../../typechain/StreamRegistry'

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

const log = require('debug')('Streamr:eth-init')

// this wallet will deploy all contracts and "own" them if applicable

// these come from the next step, but we can predict the addresses
const chainlinkNodeAddress = '0x7b5F1610920d5BAf00D684929272213BaF962eFe'
const chainlinkJobId = 'c99333d032ed4cb8967b956c7f0329b5'

let nodeRegistryAddress = ''
let streamRegistryAddress = ''
let wallet: Wallet

async function deployNodeRegistry(initialNodes: any, initialMetadata: any) {
    const strDeploy = await ethers.getContractFactory('NodeRegistry', wallet)
    const strDeployTx = await upgrades.deployProxy(strDeploy, [wallet.address, false, initialNodes, initialMetadata], { kind: 'uups' })
    // const strDeployTx = await strDeploy.deploy(wallet.address, false, initialNodes, initialMetadata)
    const str = await strDeployTx.deployed()
    nodeRegistryAddress = str.address
    log(`NodeRegistry deployed at ${str.address}`)
    const nodes = await str.getNodes()
    log(`NodeRegistry nodes : ${JSON.stringify(nodes)}`)
}

async function deployStreamStorageRegistry() {
    const strDeploy = await ethers.getContractFactory('StreamStorageRegistry', wallet)
    const strDeployTx = await upgrades.deployProxy(strDeploy,
        [streamRegistryAddress, nodeRegistryAddress, Wallet.createRandom().address], { kind: 'uups' })
    const str = await strDeployTx.deployed()
    log(`StreamStorageRegistry deployed at ${str.address}`)
}

async function deployStreamRegistry() {
    // log('Sending some Ether to chainlink node address')
    // const tx = await wallet.sendTransaction({
    //     to: chainlinkNodeAddress,
    //     value: parseEther('10')
    // })
    // await tx.wait()

    log('Deploying Streamregistry and chainlink contracts to sidechain:')

    // deploy LINKtoken
    // log('Deploying Streamregistry and chainlink contracts to sidechain:')
    // const linkTokenFactory = await ethers.getContractFactory('LinkToken', wallet)
    // const linkTokenFactoryTx = await linkTokenFactory.deploy()
    // const linkToken = await linkTokenFactoryTx.deployed()
    // LINKTOKEN_ADDRESS = linkToken.address
    // log(`Link Token deployed at ${linkToken.address}`)

    // oracle
    const oracleFactory = await ethers.getContractFactory('Oracle', wallet)
    // const oracleFactoryTx = await oracleFactory.attach('0x36BF71D0ba2e449fc14f9C4cF51468948E4ED27D')
    const oracleFactoryTx = await oracleFactory.deploy(LINKTOKEN_ADDRESS)
    const oracle1 = await oracleFactoryTx.deployed()
    const oracle = await oracle1.connect(wallet)

    log(`Chainlink Oracle deployed at ${oracle.address}`)
    const tokenaddrFromOracle = await oracle.getChainlinkToken()
    log(`Chainlink Oracle token pointing to ${tokenaddrFromOracle}`)
    // const fulfilmentPermissionTX = await oracle.setFulfillmentPermission(chainlinkNodeAddress, true)
    // await fulfilmentPermissionTX.wait()
    const permission = await oracle.getAuthorizationStatus(chainlinkNodeAddress)
    log(`Chainlink Oracle permission for ${chainlinkNodeAddress} is ${permission}`)

    // chainlink client enscache
    // log(`deploying enscache from ${wallet.address}`)
    const ensCacheFactory = await ethers.getContractFactory('ENSCache', wallet)
    const ensCacheFactoryTx = await ensCacheFactory.deploy(oracle.address, chainlinkJobId) // , constants.AddressZero)
    // const ensCacheFactoryTx = await ensCacheFactory.attach('0x870528c1aDe8f5eB4676AA2d15FC0B034E276A1A') // , constants.AddressZero)
    log(`probable addres ENSCache will be deployed to: ${ensCacheFactoryTx.address}`)
    log(`txhash of deployment transaction: ${ensCacheFactoryTx.deployTransaction.hash}`)
    const ensCache = await ensCacheFactoryTx.deployed()
    log(`ENSCache deployed at ${ensCache.address}`)
    // log(`ENSCache owner is ${await ensCache.owner()}`)
    // log(`ENSCache setting Link token address ${LINKTOKEN_ADDRESS}`)
    // await ensCache.setChainlinkTokenAddress(LINKTOKEN_ADDRESS)

    // log('Sending some Link to ENSCache')
    // await linkToken.transfer(ensCache.address, bigNumberify('1000000000000000000000')) // 1000 link

    log('deploying Streamregistry')
    const streamRegistryFactory = await ethers.getContractFactory('StreamRegistry', wallet)
    // const streamRegistryFactoryTx = await streamRegistryFactory.deploy(ensCache.address, constants.AddressZero)
    const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory,
        [ensCache.address, Wallet.createRandom().address], { kind: 'uups' })
    const streamRegistry = await streamRegistryFactoryTx.deployed()
    streamRegistryAddress = streamRegistry.address
    log(`Streamregistry deployed at ${streamRegistry.address}`)

    log('setting Streamregistry address in ENSCache')
    const tx3 = await ensCache.setStreamRegistry(streamRegistry.address)
    await tx3.wait()

    log('setting enscache address as trusted role in streamregistry')
    const role = await streamRegistry.TRUSTED_ROLE()
    log(`granting role ${role} ensaddress ${ensCache.address}`)
    const tx2 = await streamRegistry.grantRole(role, ensCache.address)
    await tx2.wait()
    log('granting role trusted role to deployer')
    const tx6 = await streamRegistry.grantRole(role, wallet.address)
    await tx6.wait()

    // console.log('##1')
    // const tx4 = await streamRegistry.trustedSetStreamMetadata('asdf/asdf', 'asdf')
    // await tx4.wait()
    // console.log('##2')
    console.log('setting enscache address as trusted role in streamregistry')
    console.log(`granting role ${role} ensaddress ${ensCache.address}`)
    const tx5 = await streamRegistry.grantRole(role, ensCache.address)
    await tx5.wait()
    console.log('done granting role')
    // console.log('setting enscache in streamregistry to ' + ensCache.address)
    // const tx = await streamRegistry.setEnsCache(ensCache.address)
    // await tx.wait()
    // console.log('done setting enscache in streamregistry')
}



async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    log(`wallet address ${wallet.address}`)
    const initialNodes: string[] = []
    const initialMetadata: string[] = []
    // initialNodes.push('0xde1112f631486CfC759A50196853011528bC5FA0')
    // initialMetadata.push('{"http": "http://10.200.10.1:8891/api/v1"}')
    await deployNodeRegistry(initialNodes, initialMetadata)

    await deployStreamRegistry()

    await deployStreamStorageRegistry()
}

main()
