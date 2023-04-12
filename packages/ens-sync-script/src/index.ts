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

const ENSCacheV2Address = "0xF38aA4130AB07Ae1dF1d9F48386A16aD42768166"

const log = require("debug")("streamr:ens-sync-script")
let streamRegistryContract: Contract
let privateKey: string
let ensCacheContract: Contract
let ensContract: Contract
let timeout: NodeJS.Timeout
let delay: number
let mainnetProvider: Provider
let sidechainProvider: Provider
let mutex = Promise.resolve(true)

async function main(){
    delay = process.argv[2] ? parseInt(process.argv[2]) * 1000 : 0
    if (delay) {
        log(`starting with answer delay ${delay} milliseconds`)
    }

    let mainnetConfig
    let sidechainConfig
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
    
    const ensAddress = mainnetConfig.contracts.ENS

    streamRegistryContract = new Contract(sidechainConfig.contracts.StreamRegistry, ABIstreamRegistry.abi, sidechainProvider)

    ensCacheContract = new Contract(ENSCacheV2Address, ABIenscache.abi, sidechainProvider) // TODO
    ensContract = new Contract(ensAddress, ensAbi.abi, mainnetProvider)
    log("starting listening for events on ENSCacheV2 contract: ", ensCacheContract.address)
    ensCacheContract.on("RequestENSOwnerAndCreateStream", async (ensName, streamIdPath, metadataJsonString, requestorAddress) => {
        log("Got RequestENSOwnerAndCreateStream event params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
        const oldMutex = mutex
        mutex = new Promise(async (resolve) => {
            await oldMutex
            await handleEvent(ensName, streamIdPath, metadataJsonString, requestorAddress)
            resolve(true)
        })
    })

    log("starting listening for createstream events on StreamRegistry contract: ", streamRegistryContract.address)
    streamRegistryContract.on("StreamCreated", async (streamId, metadataJsonString) => {
        log("Got StreamCreated event params: ", streamId, metadataJsonString)
    })
}

async function handleEvent(ensName: string, streamIdPath: string, metadataJsonString: string, requestorAddress: string) {
    log("handling event params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
    const ensHashedName = namehash.hash(ensName)
    const owner = await ensContract.owner(ensHashedName)
    log("ENS owner queried from mainnet: ", owner)
    const domainOwnerSidechain = new Wallet(privateKey, sidechainProvider)
        
    ensCacheContract = ensCacheContract.connect(domainOwnerSidechain)
    if (requestorAddress == owner) {
        log("Requestor is owner, trying to call fulfillENSOwner")
        if (delay > 0) {
            log(`delaying ${delay} seconds`)
            await Promise.race([
                new Promise((resolve) => {
                    timeout = setTimeout(async () => {
                        await createStream(ensName, streamIdPath, metadataJsonString, requestorAddress, true)
                        log(`delayed stream creation done`)
                        resolve(true)
                    }, delay)
                }),
                await checkIfOtherInstaceCreatedStream(ensName + streamIdPath)
            ])
        } else {
            log(`not delaying stream creation`)
            await createStream(ensName, streamIdPath, metadataJsonString, requestorAddress, true)
        }

    } else {
        log(`Requestor ${requestorAddress} is not owner ${owner}, ignoring request`)
    }
}

async function createStream(ensName: string, streamIdPath: string, metadataJsonString: string, requestorAddress: string,
    retry = false) {
    log("creating stream from ENS name: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
    try {
        const tx = await ensCacheContract.fulfillENSOwner(ensName, streamIdPath, metadataJsonString, requestorAddress)
        await tx.wait()
        log("createStreamFromENS tx: ", tx.hash)
    } catch (e) {
        log("creating stream failed, createStreamFromENS error: ", e)
        if (retry) {
            log("retrying")
            await createStream(ensName, streamIdPath, metadataJsonString, requestorAddress, false)
        }
    }
}

async function checkIfOtherInstaceCreatedStream(streamIdToCheck: string) {
    return new Promise((resolve) => {
        log("checking if other instance created stream")
        const listener = async (streamId: string, metadataJsonString: string) => {
            log("Got StreamCreated event params: ", streamId, metadataJsonString)
            if (streamId == streamIdToCheck) {
                log("cancelling creation, other script instance created stream StreamCreated event params: ", streamId, metadataJsonString)
                clearTimeout(timeout)
                streamRegistryContract.off("StreamCreated", listener)
                resolve(true)
            }
            setTimeout(async () => {
                log(`5 minutes passed, cancelling watching, other script instance did not create stream`)
                streamRegistryContract.off("StreamCreated", listener)
                resolve(true)
            }, 1000*60*5)
        }
        streamRegistryContract.on("StreamCreated", listener)
    })
}

main().then(() => {
    // debug('done')
    log("listening for events")
    return void 0
}).catch((err: any) => {
    log("error: ", err)
    process.exit(1)
})