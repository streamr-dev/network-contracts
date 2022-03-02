/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable max-len */

import Debug from 'debug'
import hhat from 'hardhat'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { MaxInt256 } from '@ethersproject/constants'

import { StreamRegistryV3 } from '../typechain/StreamRegistryV3'
import { TransactionRequest } from '@ethersproject/providers'
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
    [key: string]: { // key is stream id
        metadata: string,
        permissions: {
            [key: string]: Permission // key is the ethereum address of the permission holder
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

    private registryFromMigrator: StreamRegistryV3
    private migratorWallet: Wallet
    private networkProvider: any
    private gasPriceIncrease: number
    private originalGasPrice: number

    async migrate(streams: StreamsWithPermissions, mysql: {query: (arg0: string, arg1: string[]) => unknown }): Promise<void> {
        for (const streamid of Object.keys(streams)) {
            if (!(await this.registryFromMigrator.exists(streamid))) {
                try {
                    this.debug('creating stream ' + streamid)
                    const transaction = await this.registryFromMigrator.populateTransaction.trustedSetStreamMetadata(streamid, 'metadata')
                    await this.sendTransaction(transaction)
                } catch (e) {
                    this.debug('ERROR creating stream: ' + e)
                }
            }
        }
        const streamDataChunks = await Migrator.convertToStreamDataArray(streams)
        let updatedStreams: { [key: string]: Date} = {}
        for (const streamData of streamDataChunks) {
            try {
                await this.sendStreamsToChain(streamData)
                for (const streamDataItem of streamData) {
                    updatedStreams[streamDataItem.id] = new Date()
                }
                await this.updateDB(updatedStreams, mysql)
                updatedStreams = {}
            } catch (err) {
                this.debug('error sending permission chunks to chain: ' + err)
            }
        }
    }
    async sendTransaction(tx: TransactionRequest): Promise<void> {
        try {
            this.debug('sending transaction')

            let replacementTimer = setTimeout(() => {}, 0)
            const replaceTX = () => {
                return new Promise((resolve, reject) => {
                    replacementTimer = setTimeout(async () => {
                        try {
                            const gasPriceIncreaseFactor = Number.parseInt(process.env.GASPRICE_INCREASE_PERCENT!) / 100
                            let gasPrice = 0
                            if (tx.gasPrice) {
                                gasPrice = (tx.gasPrice as BigNumber).toNumber()
                            } else {
                                gasPrice = await this.networkProvider.getGasPrice()
                                this.originalGasPrice = gasPrice
                                this.gasPriceIncrease = gasPrice * gasPriceIncreaseFactor
                            }
                            const newGasPrice = Math.ceil(+gasPrice + +this.gasPriceIncrease)
                            if (newGasPrice > this.originalGasPrice * 3) {
                                reject(new Error('gas price got too high, aborting'))
                            }
                            this.debug(`nothing happened for a while, increasing gas price from ${gasPrice} to ${newGasPrice}`)
                            // eslint-disable-next-line require-atomic-updates
                            tx.gasPrice = BigNumber.from(newGasPrice)
                            await this.sendTransaction(tx)
                            resolve(void 0)
                        } catch (e) {
                            reject(e)
                        }
                    }, Number.parseInt(process.env.GASPRICE_INCREASE_TIMEOUT_MS!))
                })
            }

            const sendTx = async() => {
                const response = await this.migratorWallet.sendTransaction(tx)
                this.debug('sent, waiting for transaction with hash ' + response.hash)
                const receipt = await response.wait()
                this.debug('mined transaction with hash ' + receipt.transactionHash)
                return receipt
            }

            await Promise.race([replaceTX(), sendTx()])
            clearTimeout(replacementTimer)
        } catch (err: any) {
            if (err.code === 'TRANSACTION_REPLACED') { this.debug('a transaction got replaced') }
            else { throw err }
        }
        // throw('transaction failed')
        // return (await this.migratorWallet.sendTransaction(tx)).wait()
        // {
        //     gasPrice: this.networkProvider.getGasPrice().then((estimatedGasPrice: BigNumber) => estimatedGasPrice.add('10000000000'))
        // }
    }

    async updateDB(streams: { [key: string]: Date }, mysql: {query: (arg0: string, arg1: string[]) => unknown }): Promise<void> {
        this.debug('updating db with ' + Object.keys(streams).length + ' streams')
        for (const streamid of Object.keys(streams)) {
            // date format conversion from "2022-03-02T10:16:20.054Z" to "2022-03-02 10:16:25"
            const updatedAt = streams[streamid].toISOString().slice(0, 19).replace('T', ' ')
            const sql = 'UPDATE stream SET migrate_sync_last_run_at = ? WHERE id = ?'
            const params = [updatedAt, streamid]
            await mysql.query(sql, params)
        }
        this.debug('updated streams updatedAt time in DB')
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
        this.migratorWallet = new ethers.Wallet(process.env.MIGRATOR_PRIVATEKEY || '', this.networkProvider)
        const streamregistryFactory = await ethers.getContractFactory('StreamRegistryV3', this.migratorWallet)
        const registry = await streamregistryFactory.attach(process.env.STREAMREGISTRY_ADDRESS || '')
        const registryContract = await registry.deployed()
        this.registryFromMigrator = await registryContract.connect(this.migratorWallet) as StreamRegistryV3

        // debug, only needed once
        // const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATEKEY!, this.networkProvider)
        // const registryFromAdmin = await registryContract.connect(adminWallet) as StreamRegistryV3
        // const mtx = await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(),
        //     this.migratorWallet.address)
        // await mtx.wait()
        // this.debug('added migrator role to ' + this.migratorWallet.address)
    }

    async sendStreamsToChain(streamDatas: StreamData[]): Promise<void> {
        if (streamDatas.length === 0) {
            this.debug('no streams to migrate')
            return
        }
        this.debug('migrating ' + streamDatas.length + ' streams-user-permissions')
        try {
            const tx = await this.registryFromMigrator.populateTransaction.trustedSetPermissions(
                streamDatas.map((el) => el.id),
                streamDatas.map((el) => el.user),
                streamDatas.map((el) => el.permissions),
                {
                    gasPrice: this.networkProvider.getGasPrice().then((estimatedGasPrice: BigNumber) => estimatedGasPrice.add('10000000000'))
                }
            )
            await this.sendTransaction(tx)
            // await tx.wait()
            // this.debug('mined tx with nonce ' + tx.nonce)
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
