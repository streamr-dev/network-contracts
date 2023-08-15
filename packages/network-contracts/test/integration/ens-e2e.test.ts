/* eslint-disable @typescript-eslint/no-unused-vars */
import { ethers } from "hardhat"
import { Contract, providers, Wallet, utils } from "ethers"
import Debug from "debug"
const log = Debug("streamr:test:chainlink-ens")
import { config } from "@streamr/config"

import { StreamRegistry } from "../../typechain"

import { abi as ensAbi } from "@ensdomains/ens-contracts/artifacts/contracts/registry/ENSRegistry.sol/ENSRegistry.json"
import { abi as fifsAbi } from "@ensdomains/ens-contracts/artifacts/contracts/registry/FIFSRegistrar.sol/FIFSRegistrar.json"

const mainnetConfig = config.dev0
const sidechainConfig = config.dev1
const mainnetProvider = new providers.JsonRpcProvider(mainnetConfig.rpcEndpoints[0].url)
const sideChainProvider = new providers.JsonRpcProvider(sidechainConfig.rpcEndpoints[0].url)

const keyidparam = process.env.KEYID || "0"
let DEFAULTPRIVATEKEY = ""
if (keyidparam == "0") {
    DEFAULTPRIVATEKEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0" // deploymentowner of streamregistry
} else if (keyidparam == "1") {
    DEFAULTPRIVATEKEY = "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb" // owner of testdomain1.eth
} else if (keyidparam == "2") {
    DEFAULTPRIVATEKEY = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae" // owner of testdomain2.eth
}

// ens on mainnet
const ENSADDRESS = "0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03"
const FIFSADDRESS = "0x57B81a9442805f88c4617B506206531e72d96290"
const RESOLVERADDRESS = "0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c"

const ENSCacheV1 = "0xE4eA76e830a659282368cA2e7E4d18C4AE52D8B3"

const domainOwner = new Wallet(DEFAULTPRIVATEKEY, mainnetProvider)
const domainOwnerSidechain = new Wallet(DEFAULTPRIVATEKEY, sideChainProvider)
const subdomainOwner = Wallet.createRandom().connect(sideChainProvider)

let registryFromUser: StreamRegistry
let ensFromAdmin: Contract
let fifsFromAdmin: Contract
let randomENSName: string
let randomENSNameWithSubdomain: string
const metadata1 = "metadata1"

const connectToAllContracts = async () => {
    // send some eth to the subdomain owner
    // await (await ensDomainOwner.sendTransaction({ to: ensSubdomainOwnerSidechain.address, value: ethers.utils.parseEther('1') })).wait()
    await (await domainOwnerSidechain.sendTransaction({ to: subdomainOwner.address, value: ethers.utils.parseEther("1") })).wait()

    const streamregistryFactory = await ethers.getContractFactory("StreamRegistry", domainOwnerSidechain)
    const registry = await streamregistryFactory.attach(sidechainConfig.contracts.StreamRegistry)
    const registryContract = await registry.deployed()
    registryFromUser = await registryContract.connect(domainOwnerSidechain) as StreamRegistry

    const ensContract = new Contract(ENSADDRESS, ensAbi, mainnetProvider)
    ensFromAdmin = await ensContract.connect(domainOwner)

    const fifsContract = new Contract(FIFSADDRESS, fifsAbi, mainnetProvider)
    fifsFromAdmin = await fifsContract.connect(domainOwner)
}

const getRandomPath = () => {
    return "/" + Math.random().toString(36).replace(/[^a-z]+/g, "").substr(0, 5)
}

const registerENSNameOnMainnet = async () => {
    const randomDomain = Math.random().toString(36).replace(/[^a-z]+/g, "").substr(0, 5)
    randomENSName = randomDomain + ".eth"
    log("registering ens name on mainnet:", randomENSName, " owner:", domainOwner.address)
    const hashedDomain = utils.keccak256(utils.toUtf8Bytes(randomDomain))
    const nameHashedENSName = utils.namehash(randomENSName)
    let tx = await fifsFromAdmin.register(hashedDomain, domainOwner.address)
    await tx.wait()

    log("setting owner (" + domainOwner.address + "), resolver and ttl for ens")
    tx = await ensFromAdmin.setRecord(nameHashedENSName, domainOwner.address, RESOLVERADDRESS, 1000000)
    await tx.wait()

    const label = "subdomain"
    randomENSNameWithSubdomain = label + "." + randomENSName
    const nameHashedSubdomain = utils.namehash(randomENSNameWithSubdomain)
    const labelhash = utils.keccak256(utils.toUtf8Bytes(label))
    log("registering subdomain on mainnet:", randomENSNameWithSubdomain, " owner:", subdomainOwner.address)
    tx = await fifsFromAdmin.register(utils.keccak256(utils.toUtf8Bytes(randomENSNameWithSubdomain)), subdomainOwner.address)
    await tx.wait()

    log("setting owner (" + subdomainOwner.address + "), resolver and ttl for subdomain")
    tx = await ensFromAdmin.setSubnodeRecord(nameHashedENSName, labelhash, subdomainOwner.address, RESOLVERADDRESS, 1000000)
    await tx.wait()

    // log("setting subnode owner for subdomain")
    // tx = await ensFromAdmin.setSubnodeOwner(nameHashedSubdomain, "subnodelabel1", subdomainOwner.address, )
    // await tx.wait()

    // log("setting resolver for subdomain")
    // tx = await ensFromAdmin.setResolver(nameHashedSubdomain, RESOLVERADDRESS)
    // await tx.wait()

    log("querying ens owner from mainchain")
    const addr = await ensFromAdmin.owner(nameHashedENSName)
    log("queried owner of", randomENSName, ": ", addr)

    log("querying subdomain owner from mainchain")
    const subdomainOwnerQueried = await ensFromAdmin.owner(nameHashedSubdomain)
    log("queried owner of", randomENSNameWithSubdomain, ": ", subdomainOwnerQueried)
}

const changeENSOwnerOnMainnet = async () => {
    // randomENSName = "testdomain2.eth"
    const newOwner = "0xdC353aA3d81fC3d67Eb49F443df258029B01D8aB"
    log("changing owner of ens name on mainnet:", randomENSName, " owner: " + newOwner)
    const nameHashedENSName = utils.namehash(randomENSName)
    const tx = await ensFromAdmin.setOwner(nameHashedENSName, newOwner)
    await tx.wait()
    log("set owner of ens name on mainnet:", randomENSName, " owner: " + newOwner)
}

const triggerSyncOfENSNameToSidechain = async () => {

    const randomPath = getRandomPath()
    // randomENSName = "testdomain2.eth"
    log("creating stream with ensname: " + randomENSName + randomPath)
    const tx = await registryFromUser.createStreamWithENS(randomENSName, randomPath, metadata1) // fires the ens event
    // const tx = await registryFromUser.createStreamWithENS("zzhgq.eth", randomPath, metadata1) // fires the ens event
    // const tx = await ensCacheFromOwner.requestENSOwner(randomENSName)
    await tx.wait()
    log("call done")
    let streamMetaDataCreatedByChainlink = ""
    while (streamMetaDataCreatedByChainlink !== metadata1) {
        try {
            streamMetaDataCreatedByChainlink = await registryFromUser.getStreamMetadata(randomENSName + randomPath)
        } catch (err) {
            log("checking if stream is created through chainlink: metadata is ", streamMetaDataCreatedByChainlink)
            await new Promise((resolve) => {
                return setTimeout(resolve, 3000)
            })
        }
    }
    log("stream", randomENSName + randomPath, "was synced from mainchain, metadata: ", metadata1)
    log("SUCCESS, creating a stream with the ens from owner of domain worked")
}

const triggerSyncOfENSSubdomainToSidechain = async () => {
    const randomPath = getRandomPath()
    log("creating stream with subdomain from subdomainowner: " + randomENSNameWithSubdomain + randomPath)
    const tx = await registryFromUser.connect(subdomainOwner).createStreamWithENS(randomENSNameWithSubdomain, randomPath, metadata1)
    // const tx = await ensCacheFromOwner.requestENSOwner(randomENSName)
    await tx.wait()
    log("call done")
    let streamMetaDataCreatedByChainlink = ""
    while (streamMetaDataCreatedByChainlink !== metadata1) {
        try {
            streamMetaDataCreatedByChainlink = await registryFromUser.getStreamMetadata(randomENSNameWithSubdomain + randomPath)
        } catch (err) {
            log("checking if stream is created through chainlink: metadata is ", streamMetaDataCreatedByChainlink)
            await new Promise((resolve) => {
                return setTimeout(resolve, 3000)
            })
        }
    }
    log("stream", randomENSNameWithSubdomain + randomPath, "was synced from mainchain, metadata: ", metadata1)
    log("SUCCESS, creating a stream with the ens subdomain from owner of the subdomain worked")
}

async function main() {
    await connectToAllContracts()

    await registerENSNameOnMainnet()
    // await changeENSOwnerOnMainnet()
    await triggerSyncOfENSNameToSidechain()
    await triggerSyncOfENSSubdomainToSidechain()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

