/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/* eslint-disable max-len */
import { ethers } from 'hardhat'
import debug from 'debug'

import comparator from './comparator'
import { Migrator } from './Migrator'

const mysql = require('mysql')

const migrator = new Migrator()

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'core_test'
})

const main = async () => {
    connection.connect((err: any) => {
        if (err) { throw err }
        debug('Connected!')
    })

    // get all data
    // select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where stream.migrate_to_brubeck = 1
    // and user.id = permission.user_id and permission.stream_id = stream.id and permission.operation != 'stream_get' order by stream.id, user.username limit 10;

    const query = 'select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where user.id = permission.user_id'
         + ' and permission.stream_id = stream.id and permission.operation != \'stream_get\' order by stream.id, user.username limit 10;'
    connection.query(query, async (error: any, results:any, fields: any) => {
        if (error) { throw error }
        debug('number of streamr-user-combinations from DB to migrate: ' + results.length)
        const streams: any = {}
        results.forEach((queryResultLine: any) => {
            if (!streams[queryResultLine.id]) {
                streams[queryResultLine.id] = {
                    metadata: queryResultLine.metadata,
                    permissions: {}
                }
            }
            if (ethers.utils.isAddress(queryResultLine.username)) {
                if (!streams[queryResultLine.id].permissions[queryResultLine.username]) {
                    streams[queryResultLine.id].permissions[queryResultLine.username] = []
                }
                streams[queryResultLine.id].permissions[queryResultLine.username].push(queryResultLine.operation)
            } else {
                debug('skipping user ' + queryResultLine.username + ' in stream ' + queryResultLine.id + ' because user is not an address')
            }
        })
        for (const streamid of Object.keys(streams)) {
            const stream = streams[streamid]
            for (const user of Object.keys(stream.permissions)) {
                const convertedPermission = Migrator.convertPermissions(stream.permissions[user])
                stream.permissions[user] = convertedPermission
            }
        }
        const migratedFilteredOut = await comparator(streams)
        await migrator.init()
        migrator.migrate(migratedFilteredOut)
    })

    connection.end()
}

// eslint-disable-next-line promise/always-return
main().then(() => {
    debug('done')
}).catch((err: any) => {
    debug('err: ' + err)
})
