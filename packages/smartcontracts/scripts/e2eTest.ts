// first register ens domain on mainnet
// scripts/deploy.js

import { Contract } from '@ethersproject/contracts'
import { Wallet } from '@ethersproject/wallet'
import hhat from 'hardhat'

import { ENSCache } from '../typechain'
import { StreamRegistry } from '../typechain/StreamRegistry'

const { ethers } = hhat
const ensAbi = require('@ensdomains/ens/build/contracts/ENS.json')
const fifsAbi = require('@ensdomains/ens/build/contracts/FIFSRegistrar.json')
// const resolverAbi = require('@ensdomains/resolver/build/contracts/PublicResolver.json')

const MAINNETURL = 'http://192.168.0.8:8545'
const SIDECHAINURL = 'http://192.168.0.8:8546'
const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const STREAMREGISTRYADDRESS = '0x5071E3b309B11794982D640E121aBE4f849CFC98'
const ENSCACHEADDRESS = '0xb383870d47B2cb0250D8D7f620889091952Fb7f6'
const ENSADDRESS = '0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03'
const FIFSADDRESS = '0x57B81a9442805f88c4617B506206531e72d96290'
const RESOLVERADDRESS = '0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c'

const mainnetProvider = new ethers.providers.JsonRpcProvider(MAINNETURL)
const sideChainProvider = new ethers.providers.JsonRpcProvider(SIDECHAINURL)
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
    const hashedDomain = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(randomDomain))
    const nameHashedENSName = ethers.utils.namehash(randomENSName)
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
    walletMainnet = new ethers.Wallet(DEFAULTPRIVATEKEY, mainnetProvider)
    walletSidechain = new ethers.Wallet(DEFAULTPRIVATEKEY, sideChainProvider)

    const streamregistryFactory = await ethers.getContractFactory('StreamRegistry')
    const registry = await streamregistryFactory.attach(STREAMREGISTRYADDRESS)
    const registryContract = await registry.deployed()
    registryFromAdmin = await registryContract.connect(walletSidechain) as StreamRegistry

    const ensContract = new ethers.Contract(ENSADDRESS, ensAbi.abi, mainnetProvider)
    ensFomAdmin = await ensContract.connect(walletMainnet)

    const fifsContract = new ethers.Contract(FIFSADDRESS, fifsAbi.abi, mainnetProvider)
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

