/* eslint-disable no-restricted-syntax */
/* eslint-disable max-len */
import debug from 'debug'
import { BigNumber } from '@ethersproject/bignumber'

import { GraphQLClient } from './GraphQLClient'
import { Permission, StreamsWithPermissions } from './Migrator'


const graphqlClient = new GraphQLClient()
const buildQuery = (
    lastId: string,
    pageSize: number,
    streamIds: string[] = []
): string => {
    // streams (first: ${pageSize} id_gt: "${lastId}" where: {id_in: ${JSON.stringify(streamIds)}}) {
    const query = `
    {
        streams (first: ${pageSize} id_gt: "${lastId}" where: {id_in: ${JSON.stringify(streamIds)}}) {
            id
                     metadata
                     permissions {
                        id
                        userAddress
                        canEdit
                        canDelete
                        publishExpiration
                        subscribeExpiration
                        canGrant
                    }
                }
            }`
    return JSON.stringify({
        query
    })
}

const compareToMigrated = async (streamsFromDB: StreamsWithPermissions): Promise<StreamsWithPermissions> => {
    debug('comparing streams from DB to migrated streams, total: ' + Object.keys(streamsFromDB).length)
    const streamIDs = Object.keys(streamsFromDB)
    const streamsFromTheGraph = graphqlClient.fetchPaginatedResults<{id:string, metadata:string, permissions:({userAddress:string} & Permission)[]}>((lastId: string, pageSize: number) => buildQuery(lastId, pageSize, streamIDs))
    for await (const streamFromGraph of streamsFromTheGraph) {
        for (const userPermissionGraph of streamFromGraph.permissions) {
            const userPermissionsDb: Permission = streamsFromDB[streamFromGraph.id].permissions[userPermissionGraph.userAddress]
            let migrationRequired = false
            if ((userPermissionsDb.canDelete && !userPermissionGraph.canDelete)
                || (userPermissionsDb.canEdit && !userPermissionGraph.canEdit)
                || (userPermissionsDb.canGrant && !userPermissionGraph.canGrant)
                || BigNumber.from(userPermissionsDb.publishExpiration).gt(userPermissionGraph.publishExpiration)
                || BigNumber.from(userPermissionsDb.subscribeExpiration).gt(userPermissionGraph.subscribeExpiration)) {
                migrationRequired = true
            }
            if (migrationRequired) {
                // eslint-disable-next-line no-param-reassign
                streamsFromDB[streamFromGraph.id] = {
                    ...streamsFromDB[streamFromGraph.id],
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
                delete streamsFromDB[streamFromGraph.id].permissions[userPermissionGraph.userAddress]
            }
        }
        if (streamsFromDB[streamFromGraph.id].permissions && Object.keys(streamsFromDB[streamFromGraph.id].permissions).length === 0) {
            // eslint-disable-next-line no-param-reassign
            delete streamsFromDB[streamFromGraph.id]
        }
    }
    debug('streams left to migrate at least some permissions after comparison: ' + Object.keys(streamsFromDB).length)
    return streamsFromDB
}

export default compareToMigrated
