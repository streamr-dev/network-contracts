// first register ens domain on mainnet
// scripts/deploy.js

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
let streamnumber: number = 0

const writeLine = async (stream: string, user: string, permissions: string[]) => {
    const line = stream + '\t' + user + '\t' + JSON.stringify(permissions) + '\n'
    // fs.appendFile(OUT_FILE, line, () => {})
    streamnumber++
    if (streamnumber % 10000 === 0) { console.log('written ' + streamnumber) }
}

const handleLine = async (streamid: string, user: string, permission: string) => {
    if (streamid !== currententStream) {
        writeLine(currententStream, currentUser, currentPermissions)
        currententStream = streamid
        currentUser = user
        currentPermissions = []
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
                console.log(`Read ${lineNr} lines, ${valids} valid ids, ${streamnumber} stream+user combos,${withoutMetrics} without metrics.`)
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

