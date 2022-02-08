/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/* eslint-disable max-len */
import { hexZeroPad } from '@ethersproject/bytes'
import { ethers } from 'hardhat'
import comparator from './comparator'
import { Migrator, Permission } from './Migrator'

const mysql = require('mysql')

const migrator = new Migrator()

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'core_test'
})

// export type PermissionData = {
//     user: string,
//     permissions: string[]
// }
// export type Stream = {
//     id: string,
//     metadata: string,
//     permissions: PermissionData[]
// }

export type StreamsWithPermissions = {
    [key: string]: {
        metadata: string,
        permissions: {
            [key: string]: Permission
        }
    }
}

const main = async () => {
    connection.connect((err: any) => {
        if (err) { throw err }
        console.log('Connected!')
    })

    // get all data
    // select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where stream.migrate_to_brubeck = 1
    // and user.id = permission.user_id and permission.stream_id = stream.id and permission.operation != 'stream_get' order by stream.id, user.username limit 10;

    // update stream.migrate_to_brubeck = 0
    // streams = {
    //     "streamid1": {
    //         "metadata": "alsdkfjadlfk",
    //         "permissions": {
    //              "userid1": ["stream_get", "stream_post", "stream_delete"],
    //              "userid2": ["stream_get", "stream_post", "stream_delete"]
    //         }
    //     }
    // }

    const query = 'select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where user.id = permission.user_id'
         + ' and permission.stream_id = stream.id and permission.operation != \'stream_get\' order by stream.id, user.username limit 10;'
    connection.query(query, async (error: any, results:any, fields: any) => {
        if (error) { throw error }
        console.log('data from db: ', results)
        const streams: any = {}
        results.forEach((stream: any) => {
            if (!streams[stream.id]) {
                streams[stream.id] = {
                    metadata: stream.metadata,
                    permissions: {}
                }
            }
            if (ethers.utils.isAddress(stream.username)) {
                if (!streams[stream.id].permissions[stream.username]) {
                    streams[stream.id].permissions[stream.username] = []
                }
                streams[stream.id].permissions[stream.username].push(stream.operation)
            }
        })
        // convert permisssions here...
        for (const streamid of Object.keys(streams)) {
            const stream = streams[streamid]
            for (const user of Object.keys(stream.permissions)) {
                const convertedPermission = Migrator.convertPermissions(stream.permissions[user])
                stream.permissions[user] = convertedPermission
            }
        }

        console.log('converted streams from db: ', streams)
        const migratedFilteredOut = await comparator(streams)
        await migrator.init()
        migrator.migrate(migratedFilteredOut)
    })

    connection.end()
}

// eslint-disable-next-line promise/always-return
main().then(() => {
    console.log('done')
}).catch((err: any) => {
    console.log('err: ', err)
})
