// first register ens domain on mainnet
// scripts/deploy.js

import * as fs from 'fs'

import es from 'event-stream'
import { Contract } from '@ethersproject/contracts'
import { NonceManager } from '@ethersproject/experimental'
import { Wallet } from '@ethersproject/wallet'
import hhat from 'hardhat'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
// import { Signer } from '@ethersproject/abstract-signer'

// import { mnemonicToSeed } from '@ethersproject/hdnode'
import { StreamRegistry } from '../typechain/StreamRegistry'

const { ethers } = hhat

const CHAIN_NODE_URL = 'http://localhost:8546'
const ADMIN_PRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const MIGRATOR_PRIVATEKEY = '0x0000000000000000000000000000000000000000000000000000000000000001'
const STREAMREGISTRY_ADDRESS = '0x338090C5492C5c5E41a4458f5FC4b205cbc54A24'

export type StreamData = {
    id: string,
    metadata?: string,
    user?: string,
    permissions?: {
        edit: boolean;
        canDelete: boolean;
        publishExpiration: BigNumberish;
        subscribeExpiration: BigNumberish;
        share: boolean;
    }[]
}

let adminWallet : Wallet
let migratorWallet : Wallet
let registryFromAdmin : StreamRegistry
let registryFromMigrator : StreamRegistry
let streamsToMigrate: StreamData[] = []
let nonceManager: NonceManager
let nonce: number

// const getRandomPath = () => {
//     return '/' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)
// }
const sendStreamsToChain = async (streams: StreamData[]) => {
    const permissions = new Array(streams.length)
    permissions.fill({
        edit: true,
        canDelete: true,
        publishExpiration: 0,
        subscribeExpiration: 0,
        share: true,
    })
    const fakeAddr = Wallet.createRandom().address
    const users = new Array(streams.length)
    users.fill(fakeAddr)
    const metadatas = new Array(streams.length)
    metadatas.fill('')

    // nonceManager.setTransactionCount(nonce)
    // nonce += 1

    try {
        const n2 = nonce
        const tx = await registryFromMigrator.populateTransaction.trustedBulkAddStreams(
            streams.map((stream) => stream.id), users, metadatas, permissions
        )
        tx.nonce = nonce
        // tx.gasLimit = BigNumber.from(6000000)
        console.log(`sending nonce: ${nonce}, gas: ${tx.gasLimit}`)
        nonce += 1

        // const signedtx = await migratorWallet.signTransaction(tx)
        const tx2 = await migratorWallet.sendTransaction(tx)
        const receipt = await tx2.wait()
        console.log('sent ' + n2)
    } catch (err) {
        console.log(err)
    }
}

const addAndSendStream = async (id: string) => {
    process.stdout.write('.')
    streamsToMigrate.push({ id })
    if (streamsToMigrate.length >= 3) {
        const clonedArr = streamsToMigrate.map((a) => ({ ...a }))
        // const a1 = streamsToMigrate.splice(0, 50)
        // const a2 = streamsToMigrate.splice(0, 50)
        streamsToMigrate = []
        // nonce += 1
        // nonceManager.setTransactionCount(nonce)
        sendStreamsToChain(clonedArr)
        // nonce += 1
        // nonceManager.setTransactionCount(nonce)
        // sendStreamsToChain(a2)
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return Promise.resolve()
}

async function main() {
    let lineNr = 0
    let valids = 0
    let withoutMetrics = 0

    const networkProvider = new ethers.providers.JsonRpcProvider(CHAIN_NODE_URL)
    adminWallet = new ethers.Wallet(ADMIN_PRIVATEKEY, networkProvider)
    migratorWallet = new ethers.Wallet(MIGRATOR_PRIVATEKEY, networkProvider)
    nonceManager = new NonceManager(migratorWallet)
    const { signer } = nonceManager
    const streamregistryFactory = await ethers.getContractFactory('StreamRegistry')
    const registry = await streamregistryFactory.attach(STREAMREGISTRY_ADDRESS)
    const registryContract = await registry.deployed()
    registryFromAdmin = await registryContract.connect(adminWallet) as StreamRegistry
    registryFromMigrator = await registryContract.connect(signer) as StreamRegistry
    nonce = await nonceManager.getTransactionCount()
    console.log('startnonce: ' + nonce)
    const mtx = await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(), migratorWallet.address)
    await mtx.wait(2)
    console.log('added migrator role to ' + migratorWallet.address)
    let resolver: any
    const promise = new Promise((resolve) => { resolver = resolve })
    const s = fs.createReadStream('./out.tsv')
        .pipe(es.split())
        .pipe(es.mapSync(async (line: string) => {
            s.pause()
            lineNr += 1
            const id = line.split('\t')[1]
            if (id && id.includes('/')) { // && !id.includes('metrics')) {
                const address = id.split('/')[0]
                if (ethers.utils.isAddress(address)) {
                    valids += 1
                    if (!id.includes('metrics')) { withoutMetrics += 1 }
                    await addAndSendStream(id)
                }
            }
            s.resume()
        })
            .on('error', (err: any) => {
                console.log('Error while reading file.', err)
            })
            .on('end', () => {
                console.log(`Read ${lineNr} lines, ${valids} valid ids, ${withoutMetrics} without metrics.`)
                resolver(true)
            }))
    return promise
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

