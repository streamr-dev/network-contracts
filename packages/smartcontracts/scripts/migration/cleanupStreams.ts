// without metrics Read 3220084 lines, 23955 streams, 1017490 valid ids, 953081 stream+user combos,0 without metrics.
// with metrics Read 3220084 lines, 435427 streams, 3075190 valid ids, 1365005 stream+user combos,0 without metrics.


import * as fs from 'fs'

import es from 'event-stream'
import { Contract } from '@ethersproject/contracts'
import { NonceManager } from '@ethersproject/experimental'
import { Wallet } from '@ethersproject/wallet'
import hhat from 'hardhat'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
// import { Signer } from '@ethersproject/abstract-signer'
const { ethers } = hhat

const IN_FILE = ('./streamData.tsv')
const OUT_FILE = ('./streamData_cleaned.tsv')

let currententStream: string
let currentUser: string
let currentPermissions: string[]
let streamUserCombos: number = 0
let streams: number = 0

const writeLine = async (stream: string, user: string, permissions: string[]) => {
    const line = stream + '\t' + user + '\t' + JSON.stringify(permissions) + '\n'
    fs.appendFile(OUT_FILE, line, () => {})
    streamUserCombos++
    if (streamUserCombos % 10000 === 0) { console.log('written ' + streamUserCombos) }
}

const handleLine = async (streamid: string, user: string, permission: string) => {
    if (streamid !== currententStream) {
        writeLine(currententStream, currentUser, currentPermissions)
        currententStream = streamid
        currentUser = user
        currentPermissions = []
        streams++
    } else if (user !== currentUser) {
        writeLine(currententStream, currentUser, currentPermissions)
        currentUser = user
        currentPermissions = []
    }
    currentPermissions.push(permission)
}

async function main() {
    let lineNr = 0
    let valids = 0
    const withoutMetrics = 0

    let resolver: any
    const promise = new Promise((resolve) => { resolver = resolve })

    const s = fs.createReadStream(IN_FILE)
        .pipe(es.split())
        .pipe(es.mapSync(async (line: string) => {
            s.pause()
            lineNr += 1
            if (lineNr % 10000 === 0) { console.log('parsed ' + lineNr) }
            const words = line.split('\t')
            const streamid = words[0]
            const user = words[1]
            const permission = words[2]
            if (streamid && !streamid.includes('metrics')) { // && id.includes('/')) { // && !id.includes('metrics')) {
                // const address = id.split('/')[0]
                // if (ethers.utils.isAddress(address)) {
                if (ethers.utils.isAddress(user)) {
                    valids += 1
                    handleLine(streamid, user, permission)
                    // if (!id.includes('metrics')) { withoutMetrics += 1 }
                    // console.log(id)
                }
                // }
            }
            s.resume()
        })
            .on('error', (err: any) => {
                console.log('Error while reading file.', err)
            })
            .on('end', () => {
                console.log(`Read ${lineNr} lines, ${streams} streams, ${valids} valid ids, ${streamUserCombos} stream+user combos,${withoutMetrics} without metrics.`)
                resolver(true)
            }))
    return promise
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

