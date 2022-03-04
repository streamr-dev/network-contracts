/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable max-len */
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
    const userPermissionsGraph = graphqlClient.fetchPaginatedResults<PermissionAdditions & Permission>((lastId: string, pageSize: number) => buildQuery(lastId, pageSize, streamIDs))
    for await (const userPermissionGraph of userPermissionsGraph) {
        if (userPermissionGraph.stream === null) {
            continue
        }
        let migrationRequired = true
        if (streamsFromDB[userPermissionGraph.stream.id] === undefined || streamsFromDB[userPermissionGraph.stream.id].permissions[userPermissionGraph.userAddress] === undefined) {
            debug('didnt find user permissions in DB for stream ' + userPermissionGraph.stream.id + ' user ' + userPermissionGraph.userAddress)
            throw new Error('didnt find user permissions in DB for stream ' + userPermissionGraph.stream.id + ' user ' + userPermissionGraph.userAddress)
        }
        const userPermissionsDb: Permission = streamsFromDB[userPermissionGraph.stream.id].permissions[userPermissionGraph.userAddress]
        if ((userPermissionsDb.canDelete && !userPermissionGraph.canDelete)
                || (userPermissionsDb.canEdit && !userPermissionGraph.canEdit)
                || (userPermissionsDb.canGrant && !userPermissionGraph.canGrant)
                || BigNumber.from(userPermissionsDb.publishExpiration).gt(userPermissionGraph.publishExpiration)
                || BigNumber.from(userPermissionsDb.subscribeExpiration).gt(userPermissionGraph.subscribeExpiration)) {
            migrationRequired = true
        }
        if (migrationRequired) {
            // eslint-disable-next-line no-param-reassign
            streamsFromDB[userPermissionGraph.stream.id] = {
                ...streamsFromDB[userPermissionGraph.stream.id],
                [userPermissionGraph.userAddress]: {
                    canEdit: userPermissionsDb.canEdit || userPermissionGraph.canEdit,
                    canDelete: userPermissionsDb.canDelete || userPermissionGraph.canDelete,
                    publishExpiration: userPermissionsDb.publishExpiration < userPermissionGraph.publishExpiration
                        ? userPermissionsDb.publishExpiration : userPermissionGraph.publishExpiration,
                    subscribeExpiration: userPermissionsDb.subscribeExpiration < userPermissionGraph.subscribeExpiration
                        ? userPermissionsDb.subscribeExpiration : userPermissionGraph.subscribeExpiration,
                    canGrant: userPermissionsDb.canGrant || userPermissionGraph.canGrant
                }
            }
        } else {
            // eslint-disable-next-line no-param-reassign
            delete streamsFromDB[userPermissionGraph.stream.id].permissions[userPermissionGraph.userAddress]
        }
    }
    Object.keys(streamsFromDB).forEach((streamId) => {
        if (Object.keys(streamsFromDB[streamId].permissions).length === 0) {
            // eslint-disable-next-line no-param-reassign
            delete streamsFromDB[streamId]
        }
    })
    // if (streamsFromDB[streamFromGraph.id].permissions && Object.keys(streamsFromDB[streamFromGraph.id].permissions).length === 0) {
    //     // eslint-disable-next-line no-param-reassign
    //     delete streamsFromDB[streamFromGraph.id]
    // }
    debug('streams left to migrate at least some permissions after comparison: ' + Object.keys(streamsFromDB).length)
    return streamsFromDB
}

export default compareToMigrated
