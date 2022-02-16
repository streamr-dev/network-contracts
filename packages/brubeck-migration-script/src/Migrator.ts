/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable max-len */

import Debug from 'debug'
import hhat from 'hardhat'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { MaxInt256 } from '@ethersproject/constants'

import { StreamRegistry } from '../typechain/StreamRegistry'
import { TransactionReceipt, TransactionRequest } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'

const { ethers } = hhat

export type Permission = {
    canEdit: boolean;
    canDelete: boolean;
    publishExpiration: BigNumberish;
    subscribeExpiration: BigNumberish;
    canGrant: boolean;
}

export type StreamsWithPermissions = {
    [key: string]: {
        metadata: string,
        permissions: {
            [key: string]: Permission
        }
    }
}

export type StreamData = {
    id: string,
    user: string,
    permissions: Permission
}

export class Migrator {
    private debug = Debug('migration-script:migrator')

    private registryFromMigrator: StreamRegistry
    private migratorWallet: Wallet
    private networkProvider: any

    async migrate(streams: StreamsWithPermissions, mysql: {query: (arg0: string, arg1: string[]) => unknown }): Promise<void> {
        for (const streamid of Object.keys(streams)) {
            if (!(await this.registryFromMigrator.exists(streamid))) {
                this.debug('creating stream ' + streamid)
                const transaction = await this.registryFromMigrator.populateTransaction.trustedSetStreamMetadata(streamid, 'metadata')
                const transactionReceipt = await this.sendTransaction(transaction)
            }
        }
        const streamDataChunks = await Migrator.convertToStreamDataArray(streams)
        let updatedStreams: { [key: string]: Date} = {}
        for (const streamData of streamDataChunks) {
            await this.sendStreamsToChain(streamData)
            for (const streamDataItem of streamData) {
                updatedStreams[streamDataItem.id] = new Date()
            }
            await this.updateDB(updatedStreams, mysql)
            updatedStreams = {}
        }
    }
    // private counter = 0
    async sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt> {
        // counter += 1
        const timer = setTimeout(async () => {
            const gasPrice = (tx.gasPrice as BigNumber).toNumber()
            const newGasPrice = gasPrice * 1.2
            this.debug('nothing happened for 20s, increasing gas price to ' + newGasPrice)
            // const newGasPrice = 200
            // if (tx2.gasPrice) { tx.gasPrice = BigNumber.from(Math.ceil(newGasPrice)) }
            tx.gasPrice = BigNumber.from(Math.ceil(newGasPrice))
            this.sendTransaction(tx)
            // const txResend = await migratorWallet.sendTransaction(tx)
            // console.log(`resent tx with nonce: ${txResend.nonce}, gas: ${parseInt(txResend.gasLimit._hex, 16)}, gasPrice: ${txResend.gasPrice?.toNumber()}`)
        }, 20000)
        const response = await this.migratorWallet.sendTransaction(tx)
        this.debug('sent, waiting for transaction with hash' + response.hash + ' and gasprice ' + response.gasPrice.toNumber())
        const receipt = await response.wait()
        clearTimeout(timer)
        this.debug('mined transaction with hash ' + receipt.transactionHash)
        return receipt
        // {
        //     gasPrice: this.networkProvider.getGasPrice().then((estimatedGasPrice: BigNumber) => estimatedGasPrice.add('10000000000'))
        // }
    }

    async updateDB(streams: { [key: string]: Date }, mysql: {query: (arg0: string, arg1: string[]) => unknown }): Promise<void> {
        this.debug('updating db with ' + Object.keys(streams).length + ' streams')
        for (const streamid of Object.keys(streams)) {
            const updatedAt = streams[streamid].toISOString().slice(0, 19).replace('T', ' ')
            const sql = 'UPDATE stream SET migrate_sync_last_run_at = ? WHERE id = ?'
            const params = [updatedAt, streamid]
            await mysql.query(sql, params)
        }
    }

    static async convertToStreamDataArray(streams: StreamsWithPermissions): Promise<StreamData[][]> {
        const result: StreamData[][] = []
        let streamDatas: StreamData[] = []
        Object.keys(streams).forEach((streamid: string) => {
            const stream = streams[streamid]
            Object.keys(stream.permissions).forEach((user: string) => {
                if (streamDatas.length >= 20) {
                    result.push(streamDatas)
                    streamDatas = []
                }
                streamDatas.push({
                    id: streamid,
                    user,
                    permissions: stream.permissions[user]
                })
            })
        })
        if (streamDatas.length > 0) {
            result.push(streamDatas)
        }
        return result
    }

    async init(): Promise<void> {
        this.networkProvider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_NODE_URL)
        this.migratorWallet = new ethers.Wallet(process.env.MIGRATOR_PRIVATEKEY, this.networkProvider)
        const streamregistryFactory = await ethers.getContractFactory('StreamRegistryV3', this.migratorWallet)
        const registry = await streamregistryFactory.attach(process.env.STREAMREGISTRY_ADDRESS)
        const registryContract = await registry.deployed()
        this.registryFromMigrator = await registryContract.connect(this.migratorWallet) as StreamRegistry

        // debug, only needed once
        // const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATEKEY, this.networkProvider)
        // const registryFromAdmin = await registryContract.connect(adminWallet) as StreamRegistry
        // const mtx = await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(),
        //     migratorWallet.address)
        // await mtx.wait()
        // this.debug('added migrator role to ' + migratorWallet.address)
    }

    async sendStreamsToChain(streamDatas: StreamData[]): Promise<void> {
        if (streamDatas.length === 0) {
            this.debug('no streams to migrate')
            return
        }
        this.debug('migrating ' + streamDatas.length + ' streams-user-permissions')
        try {
            const tx = await this.registryFromMigrator.trustedSetPermissions(
                streamDatas.map((el) => el.id),
                streamDatas.map((el) => el.user),
                streamDatas.map((el) => el.permissions),
                {
                    gasPrice: this.networkProvider.getGasPrice().then((estimatedGasPrice: BigNumber) => estimatedGasPrice.add('10000000000'))
                }
            )
            await tx.wait()
            this.debug('mined tx with nonce ' + tx.nonce)
        } catch (err: any) {
            this.debug(err)
        }
    }

    static convertPermissions(permissions: string[]): Permission {
        const permissionSet = {
            canEdit: false,
            canDelete: false,
            publishExpiration: BigNumber.from(0),
            subscribeExpiration: BigNumber.from(0),
            canGrant: false,
        }
        permissions.forEach((el) => {
            switch (el) {
                case 'stream_edit':
                    permissionSet.canEdit = true
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
                    permissionSet.canGrant = true
                    break
                default:
                    break
            }
        })
        return permissionSet
    }
}
