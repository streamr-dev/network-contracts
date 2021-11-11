const fs = require('fs')

const es = require('event-stream')
const { ethers } = require('ethers')

let lineNr = 0
let valids = 0
let withoutMetrics = 0

const s = fs.createReadStream('../out.tsv')
    .pipe(es.split())
    .pipe(es.mapSync((line) => {
        s.pause()

        lineNr += 1
        // console.log(line)
        const id = line.split('\t')[1]
        if (id && id.includes('/')) { // && !id.includes('metrics')) {
            const address = id.split('/')[0]
            if (ethers.utils.isAddress(address)) {
                // console.log(id)
                valids += 1
                if (!id.includes('metrics')) { withoutMetrics += 1 }
            }
        }
        // logMemoryUsage(lineNr);
        s.resume()
    })
        .on('error', (err) => {
            console.log('Error while reading file.', err)
        })
        .on('end', () => {
            console.log(`Read ${lineNr} lines, ${valids} valid ids, ${withoutMetrics} without metrics.`)
        }))
