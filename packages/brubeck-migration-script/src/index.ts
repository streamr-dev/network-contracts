/* eslint-disable no-param-reassign */
/* eslint-disable max-len */
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
        console.log('Connected!')
    })

    // get all data
    // select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where stream.migrate_to_brubeck = 1 
    // and user.id = permission.user_id and permission.stream_id = stream.id and permission.operation != 'stream_get' order by stream.id, user.username limit 10;

    // update stream.migrate_to_brubeck = 0
    // streams = {
    //     "streamid1": {
    //         "userid1": ["stream_get", "stream_post", "stream_delete"],
    //         "userid2": ["stream_get", "stream_post", "stream_delete"]
    //     }
    // }

    const query = 'select DISTINCT stream.id, user.username, permission.operation from user, stream, permission where user.id = permission.user_id'
         + ' and permission.stream_id = stream.id and permission.operation != \'stream_get\' order by stream.id, user.username limit 10;'
    connection.query(query, async (error: any, results:any, fields: any) => {
        if (error) { throw error }
        console.log('The solution is: ', results)
        const streams: any = {}
        results.forEach((stream: any) => {
            if (!streams[stream.id]) {
                streams[stream.id] = {}
            }
            if (!streams[stream.id][stream.username]) {
                streams[stream.id][stream.username] = []
            }
            streams[stream.id][stream.username].push(stream.operation)
        })
        console.log('streams from db: ', streams)
        const migratedFilteredOut = await comparator(streams)
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
