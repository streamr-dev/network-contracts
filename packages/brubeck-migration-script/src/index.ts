/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/* eslint-disable max-len */

// get all data
// select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where stream.migrate_to_brubeck = 1
// and user.id = permission.user_id and permission.stream_id = stream.id and permission.operation != 'stream_get' order by stream.id, user.username limit 10;

//     select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation
// from user, stream, permission
// where stream.migrate_to_brubeck = 1
// and user.id = permission.user_id
// and permission.stream_id = stream.id
// and permission.operation != 'stream_get'
// order by stream.id, user.username;

// debug update migration flag to 1
// UPDATE stream SET migrate_to_brubeck = 1 LIMIT 100;

import { ethers } from 'hardhat'
import Debug from 'debug'
import 'dotenv/config'
import comparator from './comparator'
import { Migrator } from './Migrator'

import mysql from 'mysql'

const migrator = new Migrator()
const debug = Debug('migration-script:index')

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
})

const compareAndMigrate = async () => {
    const query = 'select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation from user, stream, permission where stream.migrate_to_brubeck = 1 and user.id = permission.user_id'
    + ' and permission.stream_id = stream.id and permission.operation != \'stream_get\' order by stream.id, user.username;'
    return new Promise((resolve) => {
        connection.query(query, async (error: any, results: any) => {
            if (error) { throw error }
            debug('number of streamr-user-combinations from DB to migrate: ' + results.length)
            const streams: any = {}
            results.forEach((queryResultLine: any) => {
                const metadata = JSON.stringify({
                    description: queryResultLine.description,
                    partitions: queryResultLine.partitions,
                    inactivityThresholdHours: queryResultLine.inactivity_threshold_hours
                })
                if (ethers.utils.isAddress(queryResultLine.username)) {
                    if (!streams[queryResultLine.id]) {
                        streams[queryResultLine.id] = {
                            metadata,
                            permissions: {}
                        }
                        debug('stream: ' + queryResultLine.id)
                    }
                    const userAddressLowercase = queryResultLine.username.toLowerCase()
                    if (!streams[queryResultLine.id].permissions[userAddressLowercase]) {
                        streams[queryResultLine.id].permissions[userAddressLowercase] = []
                    }
                    streams[queryResultLine.id].permissions[userAddressLowercase].push(queryResultLine.operation)
                } else {
                    // debug('skipping user ' + queryResultLine.username + ' in stream ' + queryResultLine.id + ' because user is not an address')
                }
            })
            for (const streamid of Object.keys(streams)) {
                const stream = streams[streamid]
                for (const user of Object.keys(stream.permissions)) {
                    if (Object.keys(stream.permissions[user]).length === 0) {
                        debug('ERR')
                    }
                    const convertedPermission = Migrator.convertPermissions(stream.permissions[user])
                    stream.permissions[user] = convertedPermission
                }
            }
            // const migratedFilteredOut = await comparator(streams)
            // await migrator.init()
            // await migrator.migrate(migratedFilteredOut, connection)
            resolve(void 0)
        })
    })
}

const main = async () => {
    connection.connect((err: any) => {
        if (err) { throw err }
        debug('Connected!')
    })
    while(true) {
        await compareAndMigrate()
        await new Promise((resolve) => setTimeout(resolve, Number.parseInt(process.env.PAUSE_BETWEEN_MIGRATIONS_MS || '')))
    }
}

// eslint-disable-next-line promise/always-return
// connection.connect((err: any) => {
//     if (err) { throw err }
//     debug('Connected!')
main().then(() => {
    debug('done')
    return void 0
}).catch((err: any) => {
    connection.end()
    debug('err: ' + err)
})
// })
