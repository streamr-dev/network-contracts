/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/* eslint-disable max-len */

// get all data
// select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where stream.migrate_to_brubeck = 1
// and user.id = permission.user_id and permission.stream_id = stream.id and permission.operation != 'stream_get' order by stream.id, user.username limit 10;

// select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation 
// from user, stream, permission 
// where stream.migrate_to_brubeck = 1
// and (user.id = permission.user_id OR permission.anonymous is true)
// and permission.stream_id = stream.id
// and permission.operation != 'stream_get' 
// order by stream.id, user.username;

// select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation, stream_storage_node.storage_node_address 
// from user, stream, permission, stream_storage_node 
// where stream.migrate_to_brubeck = 1
// and stream_storage_node.stream_id = stream.id
// and user.id = permission.user_id
// and permission.stream_id = stream.id 
// and permission.operation != 'stream_get' 
// order by stream.id, user.username;

// ***
// // only not anonymous
// select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation, permission.anonymous, stream_storage_node.storage_node_address
// from stream
// inner join permission on stream.id = permission.stream_id
// inner join user on permission.user_id = user.id
// left outer join stream_storage_node on stream.id = stream_storage_node.stream_id
// where stream.migrate_to_brubeck = 1
// and permission.operation != 'stream_get' 
// order by stream.id, user.username;

// // only anonymouse
// select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, permission.operation, permission.anonymous, stream_storage_node.storage_node_address
// from stream
// inner join permission on stream.id = permission.stream_id
// left outer join stream_storage_node on stream.id = stream_storage_node.stream_id
// where stream.migrate_to_brubeck = 1
// and permission.anonymous is true
// and permission.operation != 'stream_get' 
// order by stream.id;

// select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation, permission.anonymous, stream_storage_node.storage_node_address
// from stream, permission, user
// inner join permission on stream.id = permission.stream_id
// -- inner join user on permission.user_id = user.id
// left outer join stream_storage_node on stream.id = stream_storage_node.stream_id
// where stream.migrate_to_brubeck = 1
// and (user.id = permission.user_id OR permission.anonymous is true)
// and permission.operation != 'stream_get' 
// order by stream.id, user.username;

// select * from (
//     select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, 
//     case when permission.anonymous is false then (select username from user where user.id = permission.user_id) else "asdf" end as username, permission.operation, permission.anonymous, stream_storage_node.storage_node_address
//     from stream
//     -- inner join permission on stream.id = permission.stream_id
//     -- join user on permission.user_id = user.id
//     left outer join stream_storage_node on stream.id = stream_storage_node.stream_id
//     where stream.migrate_to_brubeck = 1
//     and permission.operation != 'stream_get'
//     order by stream.id, username
//     ) as t
//     where username = 'asdf'

//     select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation, permission.anonymous, stream_storage_node.storage_node_address
// from stream, permission, user, stream_storage_node
// -- left outer join stream_storage_node on 
// where stream.migrate_to_brubeck = 1
// and stream.id = permission.stream_id
// and (user.id = permission.user_id OR permission.anonymous is true)
// and stream_storage_node.stream_id = stream.id
// and permission.operation != 'stream_get' 
// order by stream.id, user.username;

// TEMP WORKING SOLUTION

// (select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, user.username, permission.operation, permission.anonymous, stream_storage_node.storage_node_address
//     from stream
//     inner join permission on stream.id = permission.stream_id
//     inner join user on permission.user_id = user.id
//     left outer join stream_storage_node on stream.id = stream_storage_node.stream_id
//     where stream.migrate_to_brubeck = 1
//     and permission.operation != 'stream_get' 
//     order by stream.id, user.username)
    
//     union
    
//     (select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours, null, permission.operation, permission.anonymous, stream_storage_node.storage_node_address
//     from stream
//     inner join permission on stream.id = permission.stream_id
//     left outer join stream_storage_node on stream.id = stream_storage_node.stream_id
//     where stream.migrate_to_brubeck = 1
//     and permission.anonymous is true
//     and permission.operation != 'stream_get' 
//     order by stream.id)

// BETTER
// select * from (
//     select DISTINCT stream.id,
//         stream.description,
//         stream.partitions,
//         stream.inactivity_threshold_hours,
//         stream.storage_days,
//         case 
//             when permission.anonymous is false then (select username from user where user.id = permission.user_id) 
//             else "0x0000000000000000000000000000000000000000"
//         end as username, 
//         permission.operation,
//         permission.ends_at,
//         stream_storage_node.storage_node_address
//     from stream
//     left join permission on permission.stream_id = stream.id
//     left outer join stream_storage_node on stream.id = stream_storage_node.stream_id
//     where stream.migrate_to_brubeck = 1
//     and permission.operation != 'stream_get'
//     and (permission.ends_at is null OR
//         permission.ends_at > now())
//     order by stream.id, username
// ) as t
// where username is not null

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
    // const query = 'select DISTINCT stream.id, stream.description, stream.partitions, stream.inactivity_threshold_hours,' +
    // 'user.username, permission.operation, stream_storage_node.storage_node_address ' +
    // 'from user, stream, permission, stream_storage_node ' +
    // 'where stream.migrate_to_brubeck = 1 ' +
    // 'and stream_storage_node.stream_id = stream.id ' +
    // 'and user.id = permission.user_id ' +
    // 'and permission.stream_id = stream.id ' +
    // 'and permission.operation != \'stream_get\' ' +
    // 'order by stream.id, user.username;'
    const query = "select * from ( " +
        "select DISTINCT stream.id, " +
            "stream.description, " +
            "stream.partitions, " +
            "stream.inactivity_threshold_hours, " +
            "stream.storage_days, " +
            "case " +
                "when permission.anonymous is false then (select username from user where user.id = permission.user_id) " +
                "else '0x0000000000000000000000000000000000000000' " +
            "end as username, " +
            "permission.operation, " +
            "permission.ends_at, " +
            "stream_storage_node.storage_node_address " +
        "from stream " +
        "left join permission on permission.stream_id = stream.id " +
        "left outer join stream_storage_node on stream.id = stream_storage_node.stream_id " +
        "where stream.migrate_to_brubeck = 1 " +
        "and permission.operation != 'stream_get' " +
        "and (permission.ends_at is null OR " +
            "permission.ends_at > now()) " +
        "order by stream.id, username " +
    ") as t " +
    "where username is not null"

    return new Promise((resolve) => {
        connection.query(query, async (error: any, results: any) => {
            if (error) { throw error }
            debug('number of streamr-user-combinations from DB to migrate: ' + results.length)
            const streams: any = {}
            for (let i = 0; i < results.length; i++) {
                const queryResultLine = results[i]
                const expiraton = queryResultLine.ends_at ? new Date(queryResultLine.ends_at).getDate() : Number.MAX_VALUE
                if (Date.now() > expiraton) {
                    debug('skipping permission for user ' + queryResultLine.username + ' in stream ' + queryResultLine.id + ' because ends_at has expired')
                    continue
                }
                if (!ethers.utils.isAddress(queryResultLine.username)) {
                    debug('skipping user ' + queryResultLine.username + ' in stream ' + queryResultLine.id + ' because user is not an address')
                    continue
                }
                const metadata = JSON.stringify({
                    description: queryResultLine.description || '',
                    partitions: queryResultLine.partitions || 1,
                    inactivityThresholdHours: queryResultLine.inactivity_threshold_hours,
                    storageDays: queryResultLine.storage_days
                })
                if (!streams[queryResultLine.id]) {
                    streams[queryResultLine.id] = {
                        metadata,
                        permissions: {}
                    }
                }
                if (queryResultLine.storage_node_address) {
                    streams[queryResultLine.id].storageNodeAddress = queryResultLine.storage_node_address
                }
                const userAddressLowercase = queryResultLine.username.toLowerCase()
                if (!streams[queryResultLine.id].permissions[userAddressLowercase]) {
                    streams[queryResultLine.id].permissions[userAddressLowercase] = []
                }
                streams[queryResultLine.id].permissions[userAddressLowercase].push(queryResultLine.operation)
            }
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
            const migratedFilteredOut = await comparator(streams)
            await migrator.init()
            await migrator.migrate(migratedFilteredOut, connection)
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
