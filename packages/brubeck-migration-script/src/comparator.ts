/* eslint-disable max-len */
import { GraphQLClient } from './GraphQLClient'

const graphqlClient = new GraphQLClient()
const buildQuery = (
    lastId: string,
    pageSize: number,
    streamIds: string[] = []
): string => {
    const query = `
    {
        streams (first: ${pageSize} id_gt: "${lastId}") {
            {
                streams (first: ${pageSize} id_gt: "${lastId}" where: {id_in: ${streamIds}}) {
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

const compareToMigrated = (streams: { id: string }[]): [] => {
    const streamIDs = streams.map((s) => s.id)
    const streamsFromTheGraph = graphqlClient.fetchPaginatedResults((lastId: string, pageSize: number) => buildQuery(lastId, pageSize, streamIDs))
    return []
}

export default compareToMigrated
