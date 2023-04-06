/* eslint-disable no-console */
import { Contract } from "@ethersproject/contracts"
import { InfuraProvider, JsonRpcProvider, Provider } from "@ethersproject/providers"
import { Wallet } from "@ethersproject/wallet"
import { Chains } from "@streamr/config"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const ABIenscache = require("../../network-contracts/artifacts/contracts/chainlinkClient/ENSCacheV2Streamr.sol/ENSCacheV2Streamr.json")
const ABIstreamRegistry = require("../../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV4.sol/StreamRegistryV4.json")
const namehash = require('eth-ens-namehash')
const ensAbi = require('@ensdomains/ens/build/contracts/ENS.json')

const log = require("debug")("streamr:ens-sync-script")

async function main(){
    
    
    let mainnetProvider: Provider
    let sidechainProvider: Provider
    let mainnetConfig
    let sidechainConfig
    let privateKey: string
    if (process.env.ENVIRONMENT === 'prod') {
        mainnetConfig = Chains.load()["ethereum"]
        sidechainConfig = Chains.load()["polygon"]
        mainnetProvider = new InfuraProvider(process.env.NETWORK, process.env.INFURA_API_KEY)
        sidechainProvider = new InfuraProvider(process.env.NETWORK, process.env.INFURA_API_KEY)
        privateKey = process.env.PRIVATE_KEY || ""
    } else {
        mainnetConfig = Chains.load()["dev0"]
        sidechainConfig = Chains.load()["dev1"]
        mainnetProvider = new JsonRpcProvider(mainnetConfig.rpcEndpoints[0].url)
        sidechainProvider = new JsonRpcProvider(sidechainConfig.rpcEndpoints[0].url)
        privateKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"
    }
    
    let ensAddress = mainnetConfig.contracts.ENS

    let streamRegistryContract = new Contract("0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222", ABIstreamRegistry.abi, sidechainProvider)
    const trustedRole = await streamRegistryContract.TRUSTED_ROLE()
    log("trusted role: ", trustedRole)
    log("ens cache has granted role on stream regsitry: ", await streamRegistryContract.hasRole(trustedRole, "0xeBB974eeCB225B3A87C1939a5204AB9b5f2Ca794"))

    let ensCacheContract = new Contract("0x0667584E38057Fb1AFc4A483254CD5c5bad519Dd", ABIenscache.abi, sidechainProvider) // TODO
    const ensContract = new Contract(ensAddress, ensAbi.abi, mainnetProvider)
    log("test1")
    ensCacheContract.on("RequestENSOwnerAndCreateStream", async (ensName, streamIdPath, metadataJsonString, requestorAddress) => {
        log("Got ENS lookup name event params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
        const ensHashedName = namehash.hash(ensName)
        let owner = await ensContract.owner(ensHashedName)
        log("ENS owner: ", owner)
        const domainOwnerSidechain = new Wallet(privateKey, sidechainProvider)
        
        ensCacheContract = ensCacheContract.connect(domainOwnerSidechain)
        if (requestorAddress == owner) {
            log("Requestor is owner, calling createStreamFromENS")
        const tx = await ensCacheContract.fulfillENSOwner(ensName, streamIdPath, metadataJsonString, requestorAddress)
            await tx.wait()
            log("createStreamFromENS tx: ", tx)
        }
    })

    log("test2")
    streamRegistryContract.on("StreamCreated", async (streamId, metadataJsonString) => {
        log("Got StreamCreated event params: ", streamId, metadataJsonString)
    })
}

main().then(() => {
    // debug('done')
    console.log("done")
    return void 0
}).catch((err: any) => {
    console.log("error: " + err)
    // connection.end()
    // debug('err: ' + err)
})