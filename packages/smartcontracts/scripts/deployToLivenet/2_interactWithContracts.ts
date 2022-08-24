// first register ens domain on mainnet
// scripts/deploy.js

import { ethers } from 'hardhat'
import { providers, Wallet } from 'ethers'

import { StreamRegistry } from '../../typechain'

// const { ethers } = hhat
// const ensAbi = require('@ensdomains/ens/build/contracts/ENS.json')
// const fifsAbi = require('@ensdomains/ens/build/contracts/FIFSRegistrar.json')
// const resolverAbi = require('@ensdomains/resolver/build/contracts/PublicResolver.json')

// hardhat
// const DEFAULTPRIVATEKEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // hardhat
// const SIDECHAINURL = 'http://localhost:8545'
// const MAINNETURL = 'http://localhost:8545'
// const LINKTOKEN = '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1'
// const DEPLOYMENT_OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// localsidechain
const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
// const MAINNETURL = 'http://localhost:8545'
const SIDECHAINURL = 'http://localhost:8546'
// const LINKTOKEN = '0x3387F44140ea19100232873a5aAf9E46608c791E'
// const DEPLOYMENT_OWNER_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'

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
// const ORACLEADDRESS = '0xD94D41F23F1D42C51Ab61685e5617BBC858e5871'
// const ENSCACHEADDRESS = '0xE4eA76e830a659282368cA2e7E4d18C4AE52D8B3'
const STREAMREGISTRYADDRESS = '0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222'
// const CHAINLINK_JOBID = 'c99333d032ed4cb8967b956c7f0329b5' // https://github.com/streamr-dev/smart-contracts-init#running
// const CHAINLINK_NODE_ADDRESS = '0x7b5F1610920d5BAf00D684929272213BaF962eFe'

// Polygon mainet contract addresses
// const ORACLEADDRESS = '0x36BF71D0ba2e449fc14f9C4cF51468948E4ED27D'
// const ENSCACHEADDRESS = '0x870528c1aDe8f5eB4676AA2d15FC0B034E276A1A'
// const STREAMREGISTRYADDRESS = '0x0D483E10612F327FC11965Fc82E90dC19b141641'
// const CHAINLINK_JOBID = '13c04b52ce0c4716bb629a872c99b153' // https://github.com/streamr-dev/smart-contracts-init#running
// const CHAINLINK_NODE_ADDRESS = '0xc244dA783A3B96f4D420A4eEfb105CD0Db4bE01a'

// ens on mainnet
// const ENSADDRESS = '0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03'
// const FIFSADDRESS = '0x57B81a9442805f88c4617B506206531e72d96290'
// const RESOLVERADDRESS = '0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c'

// const mainnetProvider = new providers.JsonRpcProvider(MAINNETURL)
const sideChainProvider = new providers.JsonRpcProvider(SIDECHAINURL)
// let walletMainnet: Wallet
let walletSidechain: Wallet
let registryFromUser: StreamRegistry
// let registryFromOwner: StreamRegistry
// let ensCacheFromOwner: ENSCache
// let linkTokenFromOwner: LinkToken
// let oracleFromOwner: Oracle
// let ensFomAdmin: Contract
// let fifsFromAdmin: Contract
// let resolverFomAdmin : Contract
// let randomENSName: string
let stringIdWithoutENS: string
const metadata1 = 'metadata1'

const connectToAllContracts = async () => {
    // walletMainnet = new Wallet(DEFAULTPRIVATEKEY, mainnetProvider)
    walletSidechain = new Wallet(DEFAULTPRIVATEKEY, sideChainProvider)
    // const deploymentOwner = new Wallet(DEPLOYMENT_OWNER_KEY, sideChainProvider)

    const streamregistryFactory = await ethers.getContractFactory('StreamRegistry', walletSidechain)
    const registry = await streamregistryFactory.attach(STREAMREGISTRYADDRESS)
    const registryContract = await registry.deployed()
    registryFromUser = await registryContract.connect(walletSidechain) as StreamRegistry
    // registryFromOwner = await registryContract.connect(deploymentOwner) as StreamRegistry

    // const ensContract = new Contract(ENSADDRESS, ensAbi.abi, mainnetProvider)
    // ensFomAdmin = await ensContract.connect(walletMainnet)

    // const fifsContract = new Contract(FIFSADDRESS, fifsAbi.abi, mainnetProvider)
    // fifsFromAdmin = await fifsContract.connect(walletMainnet)

    // const resolverContract = new ethers.Contract(RESOLVERADDRESS, resolverAbi.abi, mainnetProvider)
    // resolverFomAdmin = await resolverContract.connect(walletMainnet)

    // const ENSCacheFactory = await ethers.getContractFactory('ENSCache', walletSidechain)
    // const enscache = await ENSCacheFactory.attach(ENSCACHEADDRESS)
    // const enscacheContract = await enscache.deployed()
    // ensCacheFromOwner = await enscacheContract.connect(deploymentOwner) as ENSCache
    // ensCacheFromOwner = await enscacheContract.connect(walletSidechain) as ENSCache

    // const linkTokenFactory = await ethers.getContractFactory('LinkToken', walletSidechain)
    // const linkTokenFactoryTx = await linkTokenFactory.attach(LINKTOKEN)
    // const linkTokenContract = await linkTokenFactoryTx.deployed()
    // linkTokenFromOwner = await linkTokenContract.connect(deploymentOwner) as LinkToken

    // const oracleFactory = await ethers.getContractFactory('Oracle', walletSidechain)
    // const oracleFactoryTx = await oracleFactory.attach(ORACLEADDRESS)
    // const oracle = await oracleFactoryTx.deployed()
    // oracleFromOwner = await oracle.connect(deploymentOwner) as Oracle
}

const getRandomPath = () => {
    return '/' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
}

const createAndCheckStreamWithoutENS = async () => {
    const randomPath = getRandomPath()
    stringIdWithoutENS = walletSidechain.address.toLowerCase() + randomPath
    console.log('creating stream without ens with name ', stringIdWithoutENS, ' and metadata ', metadata1)
    const tx = await registryFromUser.createStream(randomPath, metadata1)
    console.log('transaction: ', tx)
    // await tx.wait()
    const receipt = await sideChainProvider.waitForTransaction(tx.hash, 2, 60000)
    console.log('receipt: ', receipt)
    const getMetadata = await registryFromUser.getStreamMetadata(stringIdWithoutENS)
    console.log('checking metadata from stream ', stringIdWithoutENS, ': ', getMetadata)
    console.log('SUCCESS creating stream worked')
}
/*
const setOracleFulfilmentPermission = async () => {
    console.log(`Setting Oracle fulfilment Permission for  ${CHAINLINK_NODE_ADDRESS}`)
    const fulfilmentPermissionTX = await oracleFromOwner.setFulfillmentPermission(CHAINLINK_NODE_ADDRESS, true)
    await fulfilmentPermissionTX.wait()
    const permission = await oracleFromOwner.getAuthorizationStatus(CHAINLINK_NODE_ADDRESS)
    console.log(`Chainlink Oracle permission for ${CHAINLINK_NODE_ADDRESS} is ${permission}`)
}
*/
/*
const registerENSNameOnMainnet = async () => {
    const randomDomain = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
    randomENSName = 'sam.eth'
    // randomENSName = randomDomain + '.eth'
    // console.log('registering ens name on mainnet:', randomENSName, ' owner:', walletMainnet.address)
    // const hashedDomain = utils.keccak256(utils.toUtf8Bytes(randomDomain))
    // const nameHashedENSName = utils.namehash(randomENSName)
    // let tx = await fifsFromAdmin.register(hashedDomain, walletMainnet.address)
    // await tx.wait()
    // console.log('seting resolver for ens')

    // tx = await ensFomAdmin.setResolver(nameHashedENSName, RESOLVERADDRESS)
    // await tx.wait(2)
    // console.log('setting owner for ens')

    // // tx = await resolverFomAdmin.setAddr(nameHashedENSName, '0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0')
    // // await tx.wait()
    // // console.log('3')

    // tx = await ensFomAdmin.setOwner(nameHashedENSName, walletMainnet.address)
    // await tx.wait()
    // console.log('querying owner from mainchain')

    // const addr = await ensFomAdmin.owner(nameHashedENSName)
    // console.log('queried owner of', randomENSName, ': ', addr)
}
*/
/*
const setChainlinkTokenAddressinENSCache = async () => {
    console.log('owner of enscache is ' + await ensCacheFromOwner.owner())
    console.log('used address to access is ' + walletSidechain.address)
    console.log('setting linktoken in enscache to ' + LINKTOKEN)
    const tx = await ensCacheFromOwner.setChainlinkTokenAddress(LINKTOKEN)
    await tx.wait()
    const res = await ensCacheFromOwner.getChainlinkToken()
    console.log('linktoken in enscache is ' + res)
}
*/
/*
const setStreamRegistryInEnsCache = async () => {
    console.log('setting streamregistry in enscache to ' + STREAMREGISTRYADDRESS)
    const tx = await ensCacheFromOwner.setStreamRegistry(STREAMREGISTRYADDRESS)
    await tx.wait()
    console.log('done setting streamregistry in enscache')
}
*/
/*
const upgradeStreamRegistry = async () => {
    const deploymentOwner = new Wallet(DEPLOYMENT_OWNER_KEY, sideChainProvider)
    const streamregistryFactoryV2 = await ethers.getContractFactory('StreamRegistryV2', deploymentOwner)
    console.log('upgrading Streamregistry: proxyaddress: ' + STREAMREGISTRYADDRESS)
    const streamRegistryUpgraded = await upgrades.upgradeProxy(STREAMREGISTRYADDRESS, streamregistryFactoryV2)
    console.log('streamregistry upgraded, address is (should be same): ' + streamRegistryUpgraded.address)
}
*/
/*
const setEnsCacheInStreamRegistry = async () => {
    // test role setup by creating a stream as trusted entitiy
    // console.log('##1')
    // const tx4 = await registryFromOwner.trustedSetStreamMetadata('asdf/asdf', 'asdf')
    // await tx4.wait()
    // console.log('##2')
    console.log('setting enscache address as trusted role in streamregistry')
    const role = await registryFromOwner.TRUSTED_ROLE()
    console.log(`granting role ${role} ensaddress ${ENSCACHEADDRESS}`)
    const tx2 = await registryFromOwner.grantRole(role, ENSCACHEADDRESS)
    await tx2.wait()
    console.log('done granting role')
    console.log('setting enscache in streamregistry to ' + ENSCACHEADDRESS)
    const tx = await registryFromOwner.setEnsCache(ENSCACHEADDRESS)
    await tx.wait()
    console.log('done setting enscache in streamregistry')
}
*/
/*
const grantTrustedRoleToAddress = async (trustedaddress: string) => {
    console.log(`setting ${trustedaddress} as trusted role in streamregistry`)
    const role = await registryFromOwner.TRUSTED_ROLE()
    console.log(`granting role ${role} (TRUSTED_ROLE) to ${trustedaddress}`)
    const tx2 = await registryFromOwner.grantRole(role, trustedaddress)
    await tx2.wait()
    console.log('done granting role')
}
*/
/*
const setChainlinkJobId = async () => {
    console.log('setting chainlink job id: ' + CHAINLINK_JOBID)
    const t2 = await ensCacheFromOwner.setChainlinkJobId(CHAINLINK_JOBID)
    await t2.wait()
    console.log('done setting chainlink jobid')
}
*/
/*
const triggerChainlinkSyncOfENSNameToSidechain = async () => {
    // only when redeploying locally
    // console.log('Sending some Link to ENSCache')
    // const txl = await linkTokenFromAdmin.transfer(ensCacheFromOwner.address, BigNumber.from('1000000000000000000000')) // 1000 link
    // await txl.wait()

    const randomPath = getRandomPath()
    console.log('creating stream with ensname: ' + randomENSName + randomPath)
    const tx = await registryFromUser.createStreamWithENS(randomENSName, randomPath, metadata1)
    // const tx = await ensCacheFromOwner.requestENSOwner(randomENSName)
    await tx.wait()
    console.log('call done')
    let streamMetaDataCreatedByChainlink = ''
    while (streamMetaDataCreatedByChainlink !== metadata1) {
        try {
            streamMetaDataCreatedByChainlink = await registryFromUser.getStreamMetadata(randomENSName + randomPath)
        } catch (err) {
            console.log('checking if stream is created through chainlink: metadata is ', streamMetaDataCreatedByChainlink)
            await new Promise((resolve) => {
                return setTimeout(resolve, 3000)
            })
        }
    }
    console.log('stream', randomENSName + randomPath, 'was synced from mainchain, metadata: ', metadata1)
    console.log('SUCCESS, everything worked!')
}
*/
async function main() {
    await connectToAllContracts()

    // await grantTrustedRoleToAddress('0x1D16f9833d458007D3eD7C843FBeF59A73988109')

    // set up contracts
    // await setOracleFulfilmentPermission()
    // await setChainlinkTokenAddressinENSCache()
    // await setStreamRegistryInEnsCache()
    // await setEnsCacheInStreamRegistry()
    // await setChainlinkJobId()

    // upgrade Contracts
    // await upgradeStreamRegistry()

    // test stream creation
    await createAndCheckStreamWithoutENS()

    // await registerENSNameOnMainnet()
    // await triggerChainlinkSyncOfENSNameToSidechain()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

