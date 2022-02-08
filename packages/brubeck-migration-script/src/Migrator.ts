/* eslint-disable no-await-in-loop */
/* eslint-disable max-len */

import Debug from 'debug'
import hhat from 'hardhat'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { MaxInt256 } from '@ethersproject/constants'

import { StreamRegistry } from '../typechain/StreamRegistry'
import { StreamsWithPermissions } from '.'

const { ethers } = hhat

const CHAIN_NODE_URL = 'http://localhost:8546'
// const ADMIN_PRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const ADMIN_PRIVATEKEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'
const MIGRATOR_PRIVATEKEY = '0x000000000000000000000000000000000000000000000000000000000000000c'
const STREAMREGISTRY_ADDRESS = '0xa2338F8be0941B361baBebb01ab8da5725CF0a33'
const PROGRESS_FILENAME = 'progressFile.txt'
const DATA_FILE = './streamData_cleaned.tsv'

export type Permission = {
    canEdit: boolean;
    canDelete: boolean;
    publishExpiration: BigNumberish;
    subscribeExpiration: BigNumberish;
    canGrant: boolean;
}

export type StreamData = {
    id: string,
    user: string,
    permissions: Permission
}

export class Migrator {
    private debug = Debug('Migrator')

    private registryFromMigrator : StreamRegistry

    async migrate(streams: StreamsWithPermissions): Promise<void> {
        // eslint-disable-next-line no-restricted-syntax
        for (const streamid of Object.keys(streams)) {
            if (!(await this.registryFromMigrator.exists(streamid))) {
                this.debug('creating stream ' + streamid)
                const tx = await this.registryFromMigrator.trustedSetStreamMetadata(streamid, 'metadata')
                await tx.wait()
            }
        }
        const streamDatas = await Migrator.convertToStreamDataArray(streams)
        this.sendStreamsToChain(streamDatas)
    }

    static async convertToStreamDataArray(streams:StreamsWithPermissions): Promise<StreamData[]> {
        const streamDatas: StreamData[] = []
        Object.keys(streams).forEach((streamid:string) => {
            const stream = streams[streamid]
            Object.keys(stream.permissions).forEach((user:string) => {
                streamDatas.push({
                    id: streamid,
                    user,
                    permissions: stream.permissions[user]
                })
            })
        })
        return streamDatas
    }

    async init() {
        const networkProvider = new ethers.providers.JsonRpcProvider(CHAIN_NODE_URL)
        const migratorWallet = new ethers.Wallet(MIGRATOR_PRIVATEKEY, networkProvider)
        const streamregistryFactory = await ethers.getContractFactory('StreamRegistry')
        const registry = await streamregistryFactory.attach(STREAMREGISTRY_ADDRESS)
        const registryContract = await registry.deployed()
        this.registryFromMigrator = await registryContract.connect(migratorWallet) as StreamRegistry

        // debug, only needed once
        // const adminWallet = new ethers.Wallet(ADMIN_PRIVATEKEY, networkProvider)
        // const registryFromAdmin = await registryContract.connect(adminWallet) as StreamRegistry
        // const mtx = await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(),
        //     migratorWallet.address)
        // await mtx.wait()
        // this.debug('added migrator role to ' + migratorWallet.address)
    }

    async sendStreamsToChain(streams: StreamData[]) {
        if (streams.length === 0) {
            this.debug('no streams to migrate')
            return
        }
        try {
            const tx = await this.registryFromMigrator.trustedSetPermissions(
                streams.map((el) => el.id),
                streams.map((el) => el.user),
                streams.map((el) => el.permissions)
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
