/* eslint-disable max-len */
import { TimerOptions } from 'timers'

import Debug from 'debug'
import hhat from 'hardhat'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { MaxInt256 } from '@ethersproject/constants'
// import ts from 'typescript'

import { StreamRegistry } from '../typechain/StreamRegistry'

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

export class Migrator {
    private debug = Debug('Migrator')

    private registryFromAdmin : StreamRegistry

    private registryFromMigrator : StreamRegistry

    async migrate(streams:any[]): Promise<void> {
        const streamDatas = await Migrator.convertToStreamDataArray(streams)
        this.sendStreamsToChain(streamDatas)
    }

    static async convertToStreamDataArray(streams:any[]): Promise<StreamData[]> {
        const streamDatas: StreamData[] = []
        streams.forEach((stream:any) => {
            Object.keys(stream).forEach((user:string) => {
                streamDatas.push({
                    id: stream.id,
                    metadata: stream.metadata,
                    user,
                    permissions: stream[user].map(Migrator.convertPermissions)
                })
            })
        })
        return streamDatas
    }

    async connectToStreamRegistry() {
        const networkProvider = new ethers.providers.JsonRpcProvider(CHAIN_NODE_URL)
        const adminWallet = new ethers.Wallet(ADMIN_PRIVATEKEY, networkProvider)
        const migratorWallet = new ethers.Wallet(MIGRATOR_PRIVATEKEY, networkProvider)
        const streamregistryFactory = await ethers.getContractFactory('StreamRegistry')
        const registry = await streamregistryFactory.attach(STREAMREGISTRY_ADDRESS)
        const registryContract = await registry.deployed()
        this.registryFromAdmin = await registryContract.connect(adminWallet) as StreamRegistry
        this.registryFromMigrator = await registryContract.connect(migratorWallet) as StreamRegistry
        const mtx = await this.registryFromAdmin.grantRole(await this.registryFromAdmin.TRUSTED_ROLE(),
            migratorWallet.address)
        await mtx.wait()
        this.debug.log('added migrator role to ' + migratorWallet.address)
    }

    async sendStreamsToChain(streams: StreamData[]) {
        const metadatas = new Array(streams.length)
        metadatas.fill('')
        try {
            // const tx = await this.registryFromMigrator.populateTransaction.trustedBulkAddStreams(
            const tx = await this.registryFromMigrator.trustedBulkAddStreams(
                streams.map((el) => el.id),
                streams.map((el) => el.user),
                metadatas,
                streams.map((el) => el.permissions)
            )
            // eslint-disable-next-line no-underscore-dangle
            // const timer = setTimeout(async () => {
            //     console.log(`nothing happening for 20s, resending tx with nonce ${tx2.nonce}`)
            //     const newGasPrice = (tx2.gasPrice as BigNumber).toNumber() //* 1.2
            //     // const newGasPrice = 200
            //     if (tx2.gasPrice) { tx.gasPrice = BigNumber.from(Math.ceil(newGasPrice)) }
            //     const txResend = await migratorWallet.sendTransaction(tx)
            //     console.log(`resent tx with nonce: ${txResend.nonce}, gas: ${parseInt(txResend.gasLimit._hex, 16)}, gasPrice: ${txResend.gasPrice?.toNumber()}`)
            //     await txResend.wait()
            //     console.log('mined resent tx with nonce ' + txResend.nonce)
            // }, 30000)
            // console.log(`tx2: ${JSON.stringify(tx2)}`)
            await tx.wait()
            // clearTimeout(timer)
            this.debug.log('mined tx with nonce ' + tx.nonce)
        } catch (err: any) {
            if (err.code === 'TRANSACTION_REPLACED') {
                this.debug.log('a transaction got replaced')
            } else {
                this.debug.log(err)
            }
        }
    }

    static convertPermissions(permissions: string[]) {
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
}
