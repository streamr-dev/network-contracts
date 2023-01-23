
import { ethers, upgrades } from 'hardhat'
import { Contract, providers, Wallet, utils } from 'ethers'

import { ENSCache, Oracle, StreamRegistry } from '../../typechain'

import ensAbi from '@ensdomains/ens/build/contracts/ENS.json'
import fifsAbi from '@ensdomains/ens/build/contracts/FIFSRegistrar.json'

const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const MAINNETURL = 'http://localhost:8545'
const SIDECHAINURL = 'http://localhost:8546'
const LINKTOKEN = '0x3387F44140ea19100232873a5aAf9E46608c791E'
const DEPLOYMENT_OWNER_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'

const ORACLEADDRESS = '0xD94D41F23F1D42C51Ab61685e5617BBC858e5871'
const ENSCACHEADDRESS = '0xE4eA76e830a659282368cA2e7E4d18C4AE52D8B3'
const STREAMREGISTRYADDRESS = '0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222'
const CHAINLINK_JOBID = 'c99333d032ed4cb8967b956c7f0329b5' // https://github.com/streamr-dev/smart-contracts-init#running
const CHAINLINK_NODE_ADDRESS = '0x7b5F1610920d5BAf00D684929272213BaF962eFe'

// ens on mainnet
const ENSADDRESS = '0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03'
const FIFSADDRESS = '0x57B81a9442805f88c4617B506206531e72d96290'
const RESOLVERADDRESS = '0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c'

const mainnetProvider = new providers.JsonRpcProvider(MAINNETURL)
const sideChainProvider = new providers.JsonRpcProvider(SIDECHAINURL)
let walletMainnet: Wallet
let walletSidechain: Wallet
let registryFromUser: StreamRegistry
let registryFromOwner: StreamRegistry
let ensCacheFromOwner: ENSCache
// let linkTokenFromOwner: LinkToken
let oracleFromOwner: Oracle
let ensFomAdmin: Contract
let fifsFromAdmin: Contract
// let resolverFomAdmin : Contract
let randomENSName: string
let stringIdWithoutENS: string
const metadata1 = 'metadata1'

const connectToAllContracts = async () => {
    walletMainnet = new Wallet(DEFAULTPRIVATEKEY, mainnetProvider)
    walletSidechain = new Wallet(DEFAULTPRIVATEKEY, sideChainProvider)
    const deploymentOwner = new Wallet(DEPLOYMENT_OWNER_KEY, sideChainProvider)

    const streamregistryFactory = await ethers.getContractFactory('StreamRegistry', walletSidechain)
    const registry = await streamregistryFactory.attach(STREAMREGISTRYADDRESS)
    const registryContract = await registry.deployed()
    registryFromUser = await registryContract.connect(walletSidechain) as StreamRegistry
    registryFromOwner = await registryContract.connect(deploymentOwner) as StreamRegistry

    const ensContract = new Contract(ENSADDRESS, ensAbi.abi, mainnetProvider)
    ensFomAdmin = await ensContract.connect(walletMainnet)

    const fifsContract = new Contract(FIFSADDRESS, fifsAbi.abi, mainnetProvider)
    fifsFromAdmin = await fifsContract.connect(walletMainnet)

    const ENSCacheFactory = await ethers.getContractFactory('ENSCache', walletSidechain)
    const enscache = await ENSCacheFactory.attach(ENSCACHEADDRESS)
    const enscacheContract = await enscache.deployed()
    ensCacheFromOwner = await enscacheContract.connect(deploymentOwner) as ENSCache

    const oracleFactory = await ethers.getContractFactory('Oracle', walletSidechain)
    const oracleFactoryTx = await oracleFactory.attach(ORACLEADDRESS)
    const oracle = await oracleFactoryTx.deployed()
    oracleFromOwner = await oracle.connect(deploymentOwner) as Oracle
}

const getRandomPath = () => {
    return '/' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
}

const registerENSNameOnMainnet = async () => {
    const randomDomain = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
    randomENSName = randomDomain + '.eth'
    console.log('registering ens name on mainnet:', randomENSName, ' owner:', walletMainnet.address)
    const hashedDomain = utils.keccak256(utils.toUtf8Bytes(randomDomain))
    const nameHashedENSName = utils.namehash(randomENSName)
    let tx = await fifsFromAdmin.register(hashedDomain, walletMainnet.address)
    await tx.wait()
    console.log('setting resolver for ens')

    tx = await ensFomAdmin.setResolver(nameHashedENSName, RESOLVERADDRESS)
    await tx.wait(2)
    console.log('setting owner for ens')

    tx = await ensFomAdmin.setOwner(nameHashedENSName, walletMainnet.address)
    await tx.wait()
    console.log('querying owner from mainchain')

    const addr = await ensFomAdmin.owner(nameHashedENSName)
    console.log('queried owner of', randomENSName, ': ', addr)
}


const triggerChainlinkSyncOfENSNameToSidechain = async () => {

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

async function main() {
    await connectToAllContracts()

    await registerENSNameOnMainnet()
    await triggerChainlinkSyncOfENSNameToSidechain()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

