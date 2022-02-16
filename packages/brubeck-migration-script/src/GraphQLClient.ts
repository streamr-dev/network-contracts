/* eslint-disable max-len */
import fetch from 'node-fetch'
import Debug from 'debug'

export class GraphQLClient {
    private debug = Debug('migrator')

    // private theGraphUrl: string = 'https://api.thegraph.com/subgraphs/name/streamr-network/streamr-network'
    private theGraphUrl = 'http://10.200.10.1:8000/subgraphs/name/streamr-dev/network-contracts'

    async sendQuery(gqlQuery: string): Promise<Object> {
        // this.debug('GraphQL query: %s', gqlQuery)
        const res = await fetch(this.theGraphUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                accept: '*/*',
            },
            body: gqlQuery
        })
        const resText = await res.text()
        let resJson
        try {
            resJson = JSON.parse(resText)
        } catch {
            throw new Error(`GraphQL query failed with "${resText}", check that your theGraphUrl="${this.theGraphUrl}" is correct`)
        }
        // this.debug('GraphQL response: %o', resJson)
        if (!resJson.data) {
            if (resJson.errors && resJson.errors.length > 0) {
                throw new Error('GraphQL query failed: ' + JSON.stringify(resJson.errors.map((e: any) => e.message)))
            } else {
                throw new Error('GraphQL query failed')
            }
        }
        return resJson.data
    }

    async* fetchPaginatedResults<T extends { id: string }>(
        createQuery: (lastId: string, pageSize: number) => string,
        pageSize = 1000
    ): AsyncGenerator<T, void, undefined> {
        let lastResultSet: T[] | undefined
        do {
            const lastId = (lastResultSet !== undefined) ? lastResultSet[lastResultSet.length - 1].id : ''
            const query = createQuery(lastId, pageSize)
            // eslint-disable-next-line no-await-in-loop
            const response = await this.sendQuery(query)
            const rootKey = Object.keys(response)[0] // there is a always a one root level property, e.g. "streams" or "permissions"
            const items: T[] = (response as any)[rootKey] as T[]
            yield* items
            lastResultSet = items
        } while (lastResultSet.length === pageSize)
    }

    static createWhereClause(variables: Record<string, any>): string {
        const parameterList = Object.keys(variables)
            .filter((k) => variables[k] !== undefined)
            .map((k) => k + ': $' + k)
            .join(' ')
        return `where: { ${parameterList} }`
    }
}
