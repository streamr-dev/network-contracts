import fs from 'fs'
import { Interface } from 'ethers'

const filePath = process.argv[2]
const rawAbi = JSON.parse(fs.readFileSync(filePath))
const iface = new Interface(rawAbi)
const formattedAbi = Object.values(iface.fragments).map(fragment => {
    // use full format so that we can use named event parameters
    return fragment.format('full')
})
fs.writeFileSync(filePath, JSON.stringify(formattedAbi, undefined, 4))

