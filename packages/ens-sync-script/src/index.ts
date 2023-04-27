/* eslint-disable no-console */
import { Contract } from "@ethersproject/contracts"
import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { parseUnits } from "@ethersproject/units"
import { Wallet } from "@ethersproject/wallet"
import { Chains } from "@streamr/config"
import { createRequire } from "module"
import fetch from "node-fetch"
const require = createRequire(import.meta.url)
const ABIenscache = require("../../network-contracts/artifacts/contracts/chainlinkClient/ENSCacheV2Streamr.sol/ENSCacheV2Streamr.json")
const ABIstreamRegistry = require("../../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV4.sol/StreamRegistryV4.json")
const namehash = require('eth-ens-namehash')
const ensAbi = require('@ensdomains/ens/build/contracts/ENS.json')

const {
    DELAY = "",
    ENVIRONMENT = "",
    RPC_URL = "",
    RPC_URL_MAINNET = "",
    PRIVATE_KEY = "",
} = process.env
let {
    ENSCacheV2Address = ""
} = process.env
const delay = (parseInt(DELAY) || 0) * 1000
const log = require("debug")("log:streamr:ens-sync-script")
log.log = console.log.bind(console)
log.error = console.error.bind(console)
let streamRegistryContract: Contract
let privateKey: string
let ensCacheContract: Contract
let ensContract: Contract
let mainnetProvider: Provider
let sidechainProvider: Provider
let mutex = Promise.resolve(true)
let domainOwnerSidechain: Wallet

async function main(){
    
    if (delay) {
        log(`starting with answer delay ${delay} milliseconds`)
    }

    let mainnetConfig
    let sidechainConfig
    if (ENVIRONMENT === 'prod') {
        mainnetConfig = Chains.load()["ethereum"]
        sidechainConfig = Chains.load()["polygon"]
        mainnetProvider = new JsonRpcProvider(RPC_URL_MAINNET)
        sidechainProvider = new JsonRpcProvider(RPC_URL)
        privateKey = PRIVATE_KEY
    } else {
        mainnetConfig = Chains.load()["dev0"]
        sidechainConfig = Chains.load()["dev1"]
        mainnetProvider = new JsonRpcProvider(mainnetConfig.rpcEndpoints[0].url)
        sidechainProvider = new JsonRpcProvider(sidechainConfig.rpcEndpoints[0].url)
        privateKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"
        ENSCacheV2Address = "0xe78c7E1Ee0fEFAed92758996008F5aB24aa85693"
    }
    
    const ensAddress = mainnetConfig.contracts.ENS

    streamRegistryContract = new Contract(sidechainConfig.contracts.StreamRegistry, ABIstreamRegistry.abi, sidechainProvider)
    domainOwnerSidechain = new Wallet(privateKey, sidechainProvider)
    ensCacheContract = new Contract(ENSCacheV2Address, ABIenscache.abi, domainOwnerSidechain) // TODO
    ensContract = new Contract(ensAddress, ensAbi.abi, mainnetProvider)
    log("starting listening for events on ENSCacheV2 contract: ", ensCacheContract.address)
    ensCacheContract.on("RequestENSOwnerAndCreateStream", async (ensName, streamIdPath, metadataJsonString, requestorAddress) => {
        log("Got RequestENSOwnerAndCreateStream event params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
        if (delay) {
            log("sleeping for ", delay, "ms")
            await sleep(delay)
        }
        const oldMutex = mutex
        mutex = new Promise(async (resolve) => {
            await oldMutex
            await handleEvent(ensName, streamIdPath, metadataJsonString, requestorAddress)
            resolve(true)
        })
    })

    // log("starting listening for createstream events on StreamRegistry contract: ", streamRegistryContract.address)
    // streamRegistryContract.on("StreamCreated", async (streamId, metadataJsonString) => {
    //     log("Got StreamCreated event params: ", streamId, metadataJsonString)
    // })
}

async function handleEvent(ensName: string, streamIdPath: string, metadataJsonString: string, requestorAddress: string) {
    log("handling event params: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
    const ensHashedName = namehash.hash(ensName)
    const owner = await ensContract.owner(ensHashedName)
    log("ENS owner queried from mainnet: ", owner)

    if (requestorAddress === owner) {
        await createStream(ensName, streamIdPath, metadataJsonString, requestorAddress, true)
    } else {
        log(`Requestor ${requestorAddress} is not owner ${owner}, ignoring request`)
    }
}

async function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function createStream(ensName: string, streamIdPath: string, metadataJsonString: string, requestorAddress: string, retry = false) {

    if (await streamRegistryContract.exists(ensName + streamIdPath)) {
        log("stream already exists, not creating")
        return
    }

    log("creating stream from ENS name: ", ensName, streamIdPath, metadataJsonString, requestorAddress)
    try {
        const tx = await ensCacheContract.populateTransaction.fulfillENSOwner(ensName, streamIdPath, metadataJsonString, requestorAddress)
        log("getting gasprice from polygonscan")
        const pscanAnswer = await fetch('https://gasstation-mainnet.matic.network/v2')
        const pscanJson: any = await pscanAnswer.json()

        const maxFee = Math.floor(pscanJson.fast.maxFee)
        const maxPriorityFee = Math.floor(pscanJson.fast.maxPriorityFee)
        log("result: maxFee: ", maxFee, "maxPriorityFee: ", maxPriorityFee)
        tx.maxFeePerGas = parseUnits(maxFee.toString(), "gwei").mul(2)
        tx.maxPriorityFeePerGas = parseUnits(maxPriorityFee.toString(), "gwei")
        const tr = await domainOwnerSidechain.sendTransaction(tx)
        log("createStreamFromENS tx: ", tr.hash)
    } catch (e) {
        log("creating stream failed, createStreamFromENS error: ", e)
        if (retry) {
            log("retrying")
            await createStream(ensName, streamIdPath, metadataJsonString, requestorAddress, false)
        }
    }
}

main().then(() => {
    // debug('done')
    log("listening for events")
    return void 0
}).catch((err: any) => {
    log.error("error: ", err)
    process.exit(1)
})