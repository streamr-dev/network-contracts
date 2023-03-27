/* eslint-disable no-console */
/* eslint-disable max-len */
// first register ens domain on mainnet
// scripts/deploy.js

import * as fs from 'fs'

import es from 'event-stream'
import { NonceManager } from '@ethersproject/experimental'
import { Wallet } from '@ethersproject/wallet'
import hhat from 'hardhat'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { MaxInt256 } from '@ethersproject/constants'

// import { Signer } from '@ethersproject/abstract-signer'

// import { mnemonicToSeed } from '@ethersproject/hdnode'
import { StreamRegistry } from '../../typechain/StreamRegistry'

const { ethers } = hhat

const CHAIN_NODE_URL = 'http://localhost:8546'
const ADMIN_PRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const MIGRATOR_PRIVATEKEY = '0x000000000000000000000000000000000000000000000000000000000000000c'
const STREAMREGISTRY_ADDRESS = '0xEAA002f7Dc60178B6103f8617Be45a9D3df659B6'
const PROGRESS_FILENAME = 'progressFile.txt'
const DATA_FILE = './streamData_cleaned.tsv'

export type Permission = {
    edit: boolean;
    canDelete: boolean;
    publishExpiration: BigNumberish;
    subscribeExpiration: BigNumberish;
    share: boolean;
}

export type StreamData = {
    id: string,
    metadata?: string,
    user: string,
    permissions: Permission
}

let adminWallet: Wallet
let migratorWallet: Wallet
let registryFromAdmin: StreamRegistry
let registryFromMigrator: StreamRegistry
let streamsToMigrate: StreamData[] = []
let nonceManager: NonceManager
let nonce: number
let transactionData: Array<{
    streamdata: StreamData[],
    nonce: number
}> = []
let sucessfulLineNumber = -1

// one transaction with 30 streams, one permission each costs about 2mio gas
// polygon has 20 mio blockgaslimit, 5 transactions should fit in one block (depending on how many
// permissions each stream has)
const convertPermissions = (permissions: string[]) => {
    const permissionSet = {
        edit: false,
        canDelete: false,
        publishExpiration: BigNumber.from(0),
        subscribeExpiration: BigNumber.from(0),
        share: false,
    }
    permissions.forEach((el) => {
        switch (el) {
            case 'stream_edit':
                permissionSet.edit = true
                break
            case 'stream_delete':
                permissionSet.canDelete = true
                break
            case 'stream_publish':
                permissionSet.publishExpiration = MaxInt256
                break
            case 'stream_subscribe':
                permissionSet.subscribeExpiration = MaxInt256
                break
            case 'stream_share':
                permissionSet.share = true
                break
            default:
                break
        }
    })
    return permissionSet
}

const sendStreamsToChain = async (streams: StreamData[], nonceParam: number) => {
    // const permissions = new Array(streams.length)
    // permissions.fill([{
    //     edit: true,
    //     canDelete: true,
    //     publishExpiration: 0,
    //     subscribeExpiration: 0,
    //     share: true,
    // }])
    // const fakeAddr = Wallet.createRandom().address
    // const users = new Array(streams.length)
    // users.fill(fakeAddr)
    const metadatas = new Array(streams.length)
    metadatas.fill('')

    // nonceManager.setTransactionCount(nonce)
    // nonce += 1

    try {
        const tx = await registryFromMigrator.populateTransaction.trustedBulkAddStreams(
            streams.map((el) => el.id),
            streams.map((el) => el.user),
            metadatas,
            streams.map((el) => el.permissions)
        )
        tx.nonce = nonceParam
        tx.gasPrice = BigNumber.from(1)
        // tx.gasLimit = BigNumber.from(6000000)
        // const signedtx = await migratorWallet.signTransaction(tx)
        const tx2 = await migratorWallet.sendTransaction(tx)
        // eslint-disable-next-line no-underscore-dangle
        console.log(`sent out tx: nonce: ${tx2.nonce}, gas: ${parseInt(tx2.gasLimit._hex, 16)}, gasPrice: ${tx2.gasPrice?.toNumber()}`)
        const timer = setTimeout(async () => {
            console.log(`nothing happening for 20s, resending tx with nonce ${tx2.nonce}`)
            const newGasPrice = (tx2.gasPrice as BigNumber).toNumber() + 150 //* 1.2
            // const newGasPrice = 200
            if (tx2.gasPrice) { tx.gasPrice = BigNumber.from(Math.ceil(newGasPrice)) }
            const txResend = await migratorWallet.sendTransaction(tx)
            // eslint-disable-next-line no-underscore-dangle
            console.log(`resent tx with nonce: ${txResend.nonce}, gas: ${parseInt(txResend.gasLimit._hex, 16)}, gasPrice: ${txResend.gasPrice?.toNumber()}`)
            await txResend.wait()
            console.log('mined resent tx with nonce ' + txResend.nonce)
        }, 30000)
        // console.log(`tx2: ${JSON.stringify(tx2)}`)
        await tx2.wait()
        clearTimeout(timer)
        console.log('mined tx with nonce ' + tx2.nonce)
    } catch (err: any) {
        if (err.code === 'TRANSACTION_REPLACED') { console.log('a transaction got replaced') }
        else { console.log(err) }
    }
}

const addAndSendStreamPermission = async (streamID: string, user: string, permissionStrings: string[], lineNr: number) => {
    if (lineNr <= sucessfulLineNumber) {
        return Promise.resolve()
    }
    sucessfulLineNumber = lineNr
    process.stdout.write('.')
    const permissions = convertPermissions(permissionStrings)
    streamsToMigrate.push({ id: streamID, user, permissions })
    if (streamsToMigrate.length >= 60) {
        const clonedArr = streamsToMigrate.map((a) => ({ ...a }))
        // const a1 = streamsToMigrate.splice(0, 50)
        // const a2 = streamsToMigrate.splice(0, 50)
        streamsToMigrate = []
        transactionData.push({
            streamdata: clonedArr,
            nonce
        })
        nonce += 1
        if (transactionData.length >= 5) {
            const promises = transactionData.map(
                (data) => sendStreamsToChain(data.streamdata, data.nonce)
            )
            await Promise.all(promises)
            // eslint-disable-next-line require-atomic-updates
            transactionData = []
            // fs.writeFile(PROGRESS_FILENAME, sucessfulLineNumber.toString(), (err) => {
            //     if (err) { throw err }
            //     console.log('saved current linenumber ' + sucessfulLineNumber)
            // })
            fs.writeFileSync(PROGRESS_FILENAME, sucessfulLineNumber.toString())
            console.log('saved current linenumber ' + sucessfulLineNumber)
        }
        // nonce += 1
        // nonceManager.setTransactionCount(nonce)
        // nonce += 1
        // nonceManager.setTransactionCount(nonce)
        // sendStreamsToChain(a2)
        // await new Promise((resolve) => setTimeout(resolve, 500000))
    }
    return Promise.resolve()
}

async function main() {
    let lineNr = 0
    const valids = 0
    const withoutMetrics = 0

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

    const data = fs.readFileSync(PROGRESS_FILENAME, 'utf8')
    sucessfulLineNumber = parseInt(data, 10)
    console.log('read progressFile, starting with that number: ' + sucessfulLineNumber)
    const s = fs.createReadStream(DATA_FILE)
        .pipe(es.split())
        .pipe(es.mapSync(async (line: string) => {
            s.pause()
            lineNr += 1
            const words = line.split('\t')
            const streamid = words[0]
            const user = words[1]
            const permissions = JSON.parse(words[2]) as string[]
            // const address = id.split('/')[0]
            // if (ethers.utils.isAddress(address)) {
            if (ethers.utils.isAddress(user)) {
                // valids += 1
                // if (!id.includes('metrics')) { withoutMetrics += 1 }
                // console.log(id)
                await addAndSendStreamPermission(streamid, user, permissions, lineNr)
            }
            // }
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

