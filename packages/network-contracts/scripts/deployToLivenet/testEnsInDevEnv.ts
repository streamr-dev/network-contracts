import { ethers } from 'hardhat'
import { Contract, providers, Wallet, utils } from 'ethers'

import { StreamRegistry } from '../../typechain'

import ensAbi from '@ensdomains/ens/build/contracts/ENS.json'
import fifsAbi from '@ensdomains/ens/build/contracts/FIFSRegistrar.json'

const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const MAINNETURL = 'http://localhost:8545'
const SIDECHAINURL = 'http://localhost:8546'

const STREAMREGISTRYADDRESS = '0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222'

// ens on mainnet
const ENSADDRESS = '0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03'
const FIFSADDRESS = '0x57B81a9442805f88c4617B506206531e72d96290'
const RESOLVERADDRESS = '0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c'

const mainnetProvider = new providers.JsonRpcProvider(MAINNETURL)
const sideChainProvider = new providers.JsonRpcProvider(SIDECHAINURL)
const domainOwner: Wallet = new Wallet(DEFAULTPRIVATEKEY, mainnetProvider)
const domnainOwnerSidechain: Wallet = new Wallet(DEFAULTPRIVATEKEY, sideChainProvider)
const subdomainOwner: Wallet = Wallet.createRandom().connect(sideChainProvider)
let registryFromUser: StreamRegistry
let ensFromAdmin: Contract
let fifsFromAdmin: Contract
// let resolverFromAdmin : Contract
let randomENSName: string
let randomENSNameWithSubdomain: string
const metadata1 = 'metadata1'

const connectToAllContracts = async () => {
    // send some eth to the subdomain owner
    // await (await ensDomainOwner.sendTransaction({ to: ensSubdomainOwnerSidechain.address, value: ethers.utils.parseEther('1') })).wait()
    await (await domnainOwnerSidechain.sendTransaction({ to: subdomainOwner.address, value: ethers.utils.parseEther('1') })).wait()

    const streamregistryFactory = await ethers.getContractFactory('StreamRegistry', domnainOwnerSidechain)
    const registry = await streamregistryFactory.attach(STREAMREGISTRYADDRESS)
    const registryContract = await registry.deployed()
    registryFromUser = await registryContract.connect(domnainOwnerSidechain) as StreamRegistry

    const ensContract = new Contract(ENSADDRESS, ensAbi.abi, mainnetProvider)
    ensFromAdmin = await ensContract.connect(domainOwner)

    const fifsContract = new Contract(FIFSADDRESS, fifsAbi.abi, mainnetProvider)
    fifsFromAdmin = await fifsContract.connect(domainOwner)
}

const getRandomPath = () => {
    return '/' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
}

const registerENSNameOnMainnet = async () => {
    const randomDomain = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
    randomENSName = randomDomain + '.eth'
    console.log('registering ens name on mainnet:', randomENSName, ' owner:', domainOwner.address)
    const hashedDomain = utils.keccak256(utils.toUtf8Bytes(randomDomain))
    const nameHashedENSName = utils.namehash(randomENSName)
    let tx = await fifsFromAdmin.register(hashedDomain, domainOwner.address)
    await tx.wait()

    // console.log('setting owner for ens (should already be the registrar)')
    // tx = await ensFromAdmin.setOwner(nameHashedENSName, walletMainnet.address)
    // await tx.wait()
    
    // console.log('setting resolver for ens')
    // tx = await ensFromAdmin.setResolver(nameHashedENSName, RESOLVERADDRESS)
    // await tx.wait(2)

    console.log('setting owner (' + domainOwner.address + '), resolver and ttl for ens')
    tx = await ensFromAdmin.setRecord(nameHashedENSName, domainOwner.address, RESOLVERADDRESS, 1000000)
    await tx.wait()

    const label = "subdomain"
    randomENSNameWithSubdomain = label + '.' + randomENSName
    const nameHashedSubdomain = utils.namehash(randomENSNameWithSubdomain)
    const labelhash = utils.keccak256(utils.toUtf8Bytes(label))
    console.log('registering subdomain on mainnet:', randomENSNameWithSubdomain, ' owner:', subdomainOwner.address)
    tx = await fifsFromAdmin.register(utils.keccak256(utils.toUtf8Bytes(randomENSNameWithSubdomain)), subdomainOwner.address)
    await tx.wait()

    console.log('setting owner (' + subdomainOwner.address + '), resolver and ttl for subdomain')
    tx = await ensFromAdmin.setSubnodeRecord(nameHashedENSName, labelhash, subdomainOwner.address, RESOLVERADDRESS, 1000000)
    await tx.wait()

    // console.log('setting subnode owner for subdomain')
    // tx = await ensFromAdmin.setSubnodeOwner(nameHashedSubdomain, "subnodelabel1", walletMainnet.address, )
    // await tx.wait()

    // console.log('setting resolver for subdomain')
    // tx = await ensFromAdmin.setResolver(nameHashedSubdomain, RESOLVERADDRESS)
    // await tx.wait()

    console.log('querying ens owner from mainchain')
    const addr = await ensFromAdmin.owner(nameHashedENSName)
    console.log('queried owner of', randomENSName, ': ', addr)

    console.log('querying subdomain owner from mainchain')
    const subdomainOwnerQueried = await ensFromAdmin.owner(nameHashedSubdomain)
    console.log('queried owner of', randomENSNameWithSubdomain, ': ', subdomainOwnerQueried)
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
    console.log('SUCCESS, creating a stream with the ens from owner of domain worked')
}

const triggerChainlinkSyncOfENSSubdomainToSidechain = async () => {
    const randomPath = getRandomPath()
    console.log('creating stream with subdomain from subdomainowner: ' + randomENSNameWithSubdomain + randomPath)
    const tx = await registryFromUser.connect(subdomainOwner).createStreamWithENS(randomENSNameWithSubdomain, randomPath, metadata1)
    // const tx = await ensCacheFromOwner.requestENSOwner(randomENSName)
    await tx.wait()
    console.log('call done')
    let streamMetaDataCreatedByChainlink = ''
    while (streamMetaDataCreatedByChainlink !== metadata1) {
        try {
            streamMetaDataCreatedByChainlink = await registryFromUser.getStreamMetadata(randomENSNameWithSubdomain + randomPath)
        } catch (err) {
            console.log('checking if stream is created through chainlink: metadata is ', streamMetaDataCreatedByChainlink)
            await new Promise((resolve) => {
                return setTimeout(resolve, 3000)
            })
        }
    }
    console.log('stream', randomENSNameWithSubdomain + randomPath, 'was synced from mainchain, metadata: ', metadata1)
    console.log('SUCCESS, creating a stream with the ens from owner of domain worked')
}

async function main() {
    await connectToAllContracts()

    await registerENSNameOnMainnet()
    await triggerChainlinkSyncOfENSNameToSidechain()
    await triggerChainlinkSyncOfENSSubdomainToSidechain()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

