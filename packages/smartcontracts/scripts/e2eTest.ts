// first register ens domain on mainnet
// scripts/deploy.js

import { Contract, providers, utils, Wallet } from 'ethers'
import { ethers } from 'hardhat'

import { ENSCache } from '../typechain'
import { StreamRegistry } from '../typechain/StreamRegistry'

// const { ethers } = hhat
const ensAbi = require('@ensdomains/ens/build/contracts/ENS.json')
const fifsAbi = require('@ensdomains/ens/build/contracts/FIFSRegistrar.json')
// const resolverAbi = require('@ensdomains/resolver/build/contracts/PublicResolver.json')

const MAINNETURL = 'http://localhost:8545'
const SIDECHAINURL = 'http://localhost:8546'
const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const LINKTOKEN = '0x115da13e0f2618013b8b1E21B73ca36B42C39F44'
const STREAMREGISTRYADDRESS = '0xa86863053cECFD9f6f861e0Fd39a042238411b75'
const ENSCACHEADDRESS = '0xD1d514082ED630687a5DCB85406130eD0745fA06'
const ENSADDRESS = '0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03'
const FIFSADDRESS = '0x57B81a9442805f88c4617B506206531e72d96290'
const RESOLVERADDRESS = '0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c'

const mainnetProvider = new providers.JsonRpcProvider(MAINNETURL)
const sideChainProvider = new providers.JsonRpcProvider(SIDECHAINURL)
let walletMainnet : Wallet
let walletSidechain : Wallet
let registryFromAdmin : StreamRegistry
let ensCacheFromAdmin : ENSCache
let ensFomAdmin : Contract
let fifsFromAdmin : Contract
// let resolverFomAdmin : Contract
let randomENSName : string
let stringIdWithoutENS : string
const metadata1 = 'metadata1'

const getRandomPath = () => {
    return '/' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
}
const createAndCheckStreamWithoutENS = async () => {
    const randomPath = getRandomPath()
    stringIdWithoutENS = walletSidechain.address.toLowerCase() + randomPath
    console.log('creating stream without ens with name ', stringIdWithoutENS, ' and metadata ', metadata1)
    const tx = await registryFromAdmin.createStream(randomPath, metadata1)
    await tx.wait()
    const getMetadata = await registryFromAdmin.getStreamMetadata(stringIdWithoutENS)
    console.log('checking metadata from stream ', stringIdWithoutENS, ': ', getMetadata)
    console.log('SUCCESS creating stream worked')
}

const registerENSNameOnMainnet = async () => {
    const randomDomain = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
    randomENSName = randomDomain + '.eth'
    console.log('registering ens name on mainnet:', randomENSName, ' owner:', walletMainnet.address)
    const hashedDomain = utils.keccak256(utils.toUtf8Bytes(randomDomain))
    const nameHashedENSName = utils.namehash(randomENSName)
    let tx = await fifsFromAdmin.register(hashedDomain, walletMainnet.address)
    await tx.wait()
    console.log('seting resolver for ens')

    tx = await ensFomAdmin.setResolver(nameHashedENSName, RESOLVERADDRESS)
    await tx.wait(2)
    console.log('setting owner for ens')

    // tx = await resolverFomAdmin.setAddr(nameHashedENSName, '0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0')
    // await tx.wait()
    // console.log('3')

    tx = await ensFomAdmin.setOwner(nameHashedENSName, walletMainnet.address)
    await tx.wait()
    console.log('querying owner from mainchain')

    const addr = await ensFomAdmin.owner(nameHashedENSName)
    console.log('queried owner of', randomENSName, ': ', addr)
}

const triggerChainlinkSyncOfENSNameToSidechain = async () => {
    // only when redeploying locally
    // console.log('setting linktoken in enscache')
    // let tx = await ensCacheFromAdmin.setChainlinkTokenAddress(LINKTOKEN)
    // await tx.wait()
    // console.log('setting streamregistry in enscache')
    // tx = await ensCacheFromAdmin.setStreamRegistry(STREAMREGISTRYADDRESS)
    // await tx.wait()
    // const t2 = await ensCacheFromAdmin.setChainlinkJobId('c99333d032ed4cb8967b956c7f0329b5')
    // await t2.wait()
    console.log('creating stream with ensname ' + randomENSName)
    const randomPath = getRandomPath()
    const tx = await registryFromAdmin.syncEnsAndCreateStream(randomENSName, randomPath, metadata1)
    // const tx = await ensCacheFromAdmin.requestENSOwner(randomENSName)
    await tx.wait()
    console.log('call done')
    let streamMetaDataCreatedByChainlink = ''
    while (streamMetaDataCreatedByChainlink !== metadata1) {
        try {
            streamMetaDataCreatedByChainlink = await registryFromAdmin.getStreamMetadata(randomENSName + randomPath)
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

async function main() {
    walletMainnet = new Wallet(DEFAULTPRIVATEKEY, mainnetProvider)
    walletSidechain = new Wallet(DEFAULTPRIVATEKEY, sideChainProvider)

    const streamregistryFactory = await ethers.getContractFactory('StreamRegistry')
    const registry = await streamregistryFactory.attach(STREAMREGISTRYADDRESS)
    const registryContract = await registry.deployed()
    registryFromAdmin = await registryContract.connect(walletSidechain) as StreamRegistry

    const ensContract = new Contract(ENSADDRESS, ensAbi.abi, mainnetProvider)
    ensFomAdmin = await ensContract.connect(walletMainnet)

    const fifsContract = new Contract(FIFSADDRESS, fifsAbi.abi, mainnetProvider)
    fifsFromAdmin = await fifsContract.connect(walletMainnet)

    // const resolverContract = new ethers.Contract(RESOLVERADDRESS, resolverAbi.abi, mainnetProvider)
    // resolverFomAdmin = await resolverContract.connect(walletMainnet)

    const ensOwner = new Wallet('0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae', sideChainProvider)
    const ENSCacheFactory = await ethers.getContractFactory('ENSCache')
    const enscache = await ENSCacheFactory.attach(ENSCACHEADDRESS)
    const enscacheContract = await enscache.deployed()
    ensCacheFromAdmin = await enscacheContract.connect(ensOwner) as ENSCache

    await createAndCheckStreamWithoutENS()
    console.log('SUCCESS creating stream worked')
    console.log('Now checking with ENS, registering on mainnet -> synching to sidechain -> ',
        'creating stream with ens as owner of that ens')
    await registerENSNameOnMainnet()
    await triggerChainlinkSyncOfENSNameToSidechain()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

