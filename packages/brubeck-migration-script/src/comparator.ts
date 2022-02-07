/* eslint-disable no-restricted-syntax */
/* eslint-disable max-len */
import debug from 'debug'

import { GraphQLClient } from './GraphQLClient'
import { Migrator, Permission } from './Migrator'

import { StreamsWithPermissions } from '.'

const graphqlClient = new GraphQLClient()
const buildQuery = (
    lastId: string,
    pageSize: number,
    streamIds: string[] = []
): string => {
    // streams (first: ${pageSize} id_gt: "${lastId}" where: {id_in: ${JSON.stringify(streamIds)}}) {
    const query = `
    {
                streams (first: ${pageSize} id_gt: "${lastId}") {
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
    const resultStreams: StreamsWithPermissions = {}
    const streamsFromTheGraph = graphqlClient.fetchPaginatedResults<{id:string, metadata:string, permissions:({userAddress:string} & Permission)[]}>((lastId: string, pageSize: number) => buildQuery(lastId, pageSize, streamIDs))
    for await (const streamFromGraph of streamsFromTheGraph) {
        for (const userPermissionGraph of streamFromGraph.permissions) {
            const userPermissionsDb: Permission = Migrator.convertPermissions(streamsFromDB[streamFromGraph.id].permissions[userPermissionGraph.userAddress])
            let isEqual = true
            for (const signlePermissionKey in userPermissionsDb) {
                if (userPermissionsDb[signlePermissionKey] !== userPermissionGraph[signlePermissionKey]) {
                    isEqual = false
                    break
                }
            }
            if (!isEqual) {
                resultStreams[streamFromGraph.id] = {
                    ...streamsFromDB[streamFromGraph.id],
                    permissions: {
                        
                        canEdit: true
                    }
                }
            }
        }
        // if (streamIDs.includes(stream.id)) {
        //     return []
        // }
    }
    return streams
}

export default compareToMigrated
