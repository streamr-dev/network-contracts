import hhat from 'hardhat'
import debug from 'debug'

import type { StreamRegistry } from '../typechain/StreamRegistry'

const log = debug('Streamr:scripts:createStream')
const { ethers } = hhat

const {
    REGISTRY_ADDRESS,
    STREAM_ID
} = process.env

if (!STREAM_ID) { throw new Error('Must set STREAM_ID environment variable') }
if (!REGISTRY_ADDRESS) { throw new Error('Must set REGISTRY_ADDRESS environment variable') }
const streamRegistryAddress = ethers.utils.getAddress(REGISTRY_ADDRESS!)

async function main() {
    const streamRegistry = await ethers.getContractAt('StreamRegistry', streamRegistryAddress) as StreamRegistry
    log('Streamr registry at', streamRegistry.address)
    const tx = await streamRegistry.createItem(STREAM_ID!)
    const tr = await tx.wait()
    console.log(tr!.events![0].args![0].toString()) // uint id
}

main().catch(console.error)
