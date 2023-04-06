/* eslint-disable no-console */
import { Contract } from "@ethersproject/contracts"
import { InfuraProvider, JsonRpcProvider, Provider } from "@ethersproject/providers"
import { Wallet } from "@ethersproject/wallet"
import { Chains } from "@streamr/config"
// import * as ABIenscache from "../../network-contracts/artifacts/contracts/chainlinkClient/ENSCacheV2Streamr.sol/ENSCacheV2Streamr.json"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
// const ABIenscache = require("../../network-contracts/artifacts/contracts/chainlinkClient/ENSCacheV2Streamr.sol/ENSCacheV2Streamr.json")
const ABIenscache = require("../../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV4.sol/StreamRegistryV4.json")
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
    
    let ensCacheAddress = sidechainConfig.contracts.ENSCache
    let ensAddress = mainnetConfig.contracts.ENS

    let ensCacheContract = new Contract(sidechainConfig.contracts.ENSCacheV2Streamr, ABIenscache.abi, sidechainProvider)
    const ensContract = new Contract(ensAddress, ensAbi.abi, mainnetProvider)
    log("test1")
    // event RequestENSOwnerAndCreateStream(string ensName, string streamIdPath, string metadataJsonString, address requestorAddress);
    ensCacheContract.on("RequestENSOwnerAndCreateStream", async (ensName, streamIdPath, metadataJsonString, requestorAddress) => {
        log("Got ENS lookup name event params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
        const ensHashedName = namehash.hash(ensName)
        let owner = await ensContract.owner(ensHashedName)
        log("ENS owner: ", owner)
        // const domainOwnerSidechain = new Wallet(privateKey, sidechainProvider)
        
        // ensCacheContract = ensCacheContract.connect(domainOwnerSidechain)
        // if (requestorAddress == owner) {
        //     log("Requestor is owner, calling createStreamFromENS")
        //     const tx = await ensCacheContract.fulfillENSOwnerAndCreateStream(ensName, streamIdPath, metadataJsonString, requestorAddress)
        //     await tx.wait()
        //     log("createStreamFromENS tx: ", tx)
        // }
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