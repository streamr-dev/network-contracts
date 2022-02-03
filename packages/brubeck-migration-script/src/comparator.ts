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

const compareToMigrated = async (streams: { id: string }[]): Promise<[]> => {
    const streamIDs = Object.keys(streams)
    const streamsFromTheGraph = graphqlClient.fetchPaginatedResults((lastId: string, pageSize: number) => buildQuery(lastId, pageSize, streamIDs))
    for (let stream; (stream = (await streamsFromTheGraph.next()).value); ) {
        if (streamIDs.includes(stream.id)) {
            return []
        }
    }
    return []
}

export default compareToMigrated
