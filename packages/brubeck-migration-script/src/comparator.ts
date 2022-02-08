/* eslint-disable no-restricted-syntax */
/* eslint-disable max-len */
import debug from 'debug'

import { GraphQLClient } from './GraphQLClient'
import { Permission } from './Migrator'

import { StreamsWithPermissions } from '.'
import { BigNumber } from '@ethersproject/bignumber'

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
    const streamIDs = Object.keys(streamsFromDB)
    // const resultStreams: StreamsWithPermissions = {}
    const streamsFromTheGraph = graphqlClient.fetchPaginatedResults<{id:string, metadata:string, permissions:({userAddress:string} & Permission)[]}>((lastId: string, pageSize: number) => buildQuery(lastId, pageSize, streamIDs))
    for await (const streamFromGraph of streamsFromTheGraph) {
        for (const userPermissionGraph of streamFromGraph.permissions) {
            // const userPermissionsDb: Permission = Migrator.convertPermissions(streamsFromDB[streamFromGraph.id].permissions[userPermissionGraph.userAddress])
            const userPermissionsDb: Permission = streamsFromDB[streamFromGraph.id].permissions[userPermissionGraph.userAddress]
            let migrationRequired = false
            // for (const signlePermissionKey in userPermissionsDb) {
            //     if (userPermissionsDb[signlePermissionKey] && !userPermissionGraph[signlePermissionKey]) {
            //         migrationRequired = true
            //         break
            //     }
            // }
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
    return streamsFromDB
}

export default compareToMigrated
