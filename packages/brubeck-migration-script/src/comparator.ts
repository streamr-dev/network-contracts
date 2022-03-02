/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable max-len */
/* eslint-disable no-param-reassign */
import Debug from 'debug'
import { BigNumber } from '@ethersproject/bignumber'

import { GraphQLClient } from './GraphQLClient'
import { Permission, StreamsWithPermissions } from './Migrator'

export type PermissionAdditions = {
    id: string,
    userAddress: string,
    stream: {
        id: string,
        metadata: string
    }
}
const graphqlClient = new GraphQLClient()
const debug = Debug('migration-script:compareToMigrated')
const buildQuery = (
    lastId: string,
    pageSize: number,
    streamIds: string[] = []
): string => {
    // streams (first: ${pageSize} id_gt: "${lastId}" where: {id_in: ${JSON.stringify(streamIds)}}) {
    // permissions (first: ${pageSize} id_gt: "${lastId}" where: {stream_in: ${JSON.stringify(streamIds)}}) {
    const query = `
    {
        permissions (first: ${pageSize} where: {id_gt: "${lastId}", stream_in: ${JSON.stringify(streamIds)}}) {
            id
            stream{id, metadata}
            userAddress
            canEdit
            canDelete
            publishExpiration
            subscribeExpiration
            canGrant
        }
    }`
    return JSON.stringify({
        query
    })
}

// description, partitions, inactivit threshhold
const compareToMigrated = async (streamsFromDB: StreamsWithPermissions): Promise<StreamsWithPermissions> => {
    debug('comparing streams from DB to migrated streams, total: ' + Object.keys(streamsFromDB).length)
    const streamIDs = Object.keys(streamsFromDB)
    const userPermissionsFromGraph = graphqlClient.fetchPaginatedResults<PermissionAdditions & Permission>((lastId: string, pageSize: number) => buildQuery(lastId, pageSize, streamIDs))
    for await (const fromGraph of userPermissionsFromGraph) {
        if (fromGraph.stream === null) { continue }
        if (streamsFromDB[fromGraph.stream.id] === undefined || streamsFromDB[fromGraph.stream.id].permissions[fromGraph.userAddress] === undefined) {
            debug('Didn\'t find user permissions in DB for stream ' + fromGraph.stream.id + ' user ' + fromGraph.userAddress)
            throw new Error('Didn\'t find user permissions in DB for stream ' + fromGraph.stream.id + ' user ' + fromGraph.userAddress)
        }
        const fromDB: Permission = streamsFromDB[fromGraph.stream.id].permissions[fromGraph.userAddress]

        // only migrate permissions that have been added in DB but not in smart contract
        //   also only "add" permissions, never "subtract"
        // if a permission was added to smart contract (not in DB), we don't want to delete it
        const permissionsWereAdded: boolean = ((fromDB.canDelete && !fromGraph.canDelete)
                || (fromDB.canEdit && !fromGraph.canEdit)
                || (fromDB.canGrant && !fromGraph.canGrant)
                || BigNumber.from(fromDB.publishExpiration).gt(fromGraph.publishExpiration)
                || BigNumber.from(fromDB.subscribeExpiration).gt(fromGraph.subscribeExpiration))
        if (permissionsWereAdded) {
            streamsFromDB[fromGraph.stream.id][fromGraph.userAddress] = {
                canEdit: fromDB.canEdit || fromGraph.canEdit,
                canDelete: fromDB.canDelete || fromGraph.canDelete,
                canGrant: fromDB.canGrant || fromGraph.canGrant,
                publishExpiration: fromDB.publishExpiration < fromGraph.publishExpiration ? fromDB.publishExpiration : fromGraph.publishExpiration,
                subscribeExpiration: fromDB.subscribeExpiration < fromGraph.subscribeExpiration ? fromDB.subscribeExpiration : fromGraph.subscribeExpiration,
            }
        } else {
            delete streamsFromDB[fromGraph.stream.id].permissions[fromGraph.userAddress]
        }
    }
    Object.keys(streamsFromDB).forEach((streamId) => {
        if (Object.keys(streamsFromDB[streamId].permissions).length === 0) {
            delete streamsFromDB[streamId]
        }
    })
    // if (streamsFromDB[streamFromGraph.id].permissions && Object.keys(streamsFromDB[streamFromGraph.id].permissions).length === 0) {
    //     delete streamsFromDB[streamFromGraph.id]
    // }
    debug('Streams left to migrate at least some permissions after comparison: ' + Object.keys(streamsFromDB).length)
    return streamsFromDB
}

export default compareToMigrated
