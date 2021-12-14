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
    console.log('triggering sync from mainchain to sidechain through chainlink')
    const tx = await ensCacheFromAdmin.requestENSOwner(randomENSName)
    await tx.wait()
    let syncedOwner = ''
    const address = walletSidechain.address as string
    while (syncedOwner !== address) {
        syncedOwner = await ensCacheFromAdmin.owners(randomENSName)
        console.log('checking if ens is synced through chainlink: owner is ', syncedOwner)
        await new Promise((resolve) => {
            return setTimeout(resolve, 3000)
        })
    }
    console.log('ensname', randomENSName, 'was synced from mainchain, owner: ', syncedOwner)
}

const createAndCheckStreamWithENS = async () => {
    const randomPath = getRandomPath()
    console.log('registering stream with ensname ', randomENSName, ' and path ', randomPath)
    const tx = await registryFromAdmin.createStreamWithENS(randomENSName, randomPath, metadata1)
    await tx.wait()
    const streamId = randomENSName + randomPath
    const getMetadata = await registryFromAdmin.getStreamMetadata(streamId)
    console.log('queried metadata of stream with id', streamId, ': ', getMetadata)
    if (getMetadata === metadata1) {
        console.log('SUCCESS, everything worked!')
    }
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

    const ENSCacheFactory = await ethers.getContractFactory('ENSCache')
    const enscache = await ENSCacheFactory.attach(ENSCACHEADDRESS)
    const enscacheContract = await enscache.deployed()
    ensCacheFromAdmin = await enscacheContract.connect(walletSidechain) as ENSCache

    await createAndCheckStreamWithoutENS()
    console.log('SUCCESS creating stream worked')
    console.log('Now checking with ENS, registering on mainnet -> synching to sidechain -> ',
        'creating stream with ens as owner of that ens')
    await registerENSNameOnMainnet()
    await triggerChainlinkSyncOfENSNameToSidechain()
    await createAndCheckStreamWithENS()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

