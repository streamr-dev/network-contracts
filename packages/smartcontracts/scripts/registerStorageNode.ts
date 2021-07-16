// Steps before running this file:
//   start dev env: streamr-docker-dev start graph-node
//   deploy in the localsidechain: npm run deployLocalWithExport

import { Contract } from '@ethersproject/contracts'
import { Wallet } from '@ethersproject/wallet'
import { JsonRpcProvider } from '@ethersproject/providers'

import type { StreamRegistry, NodeRegistry, StreamStorageRegistry } from '../typechain'

const { address: streamRegistryAddress, abi: streamRegistryAbi } = require('../deployments/localsidechain/StreamRegistry.json')
const { address: nodeRegistryAddress, abi: nodeRegistryAbi } = require('../deployments/localsidechain/NodeRegistry.json')
const { address: ssRegistryAddress, abi: ssRegistryAbi } = require('../deployments/localsidechain/StreamStorageRegistry.json')

const SIDECHAINURL = 'http://localhost:8546'
const DEFAULTPRIVATEKEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'

const provider = new JsonRpcProvider(SIDECHAINURL)
const wallet = new Wallet(DEFAULTPRIVATEKEY, provider)
const node = Wallet.createRandom()

async function main() {
    const streamReg = new Contract(streamRegistryAddress, streamRegistryAbi, wallet) as StreamRegistry
    const nodeReg = new Contract(nodeRegistryAddress, nodeRegistryAbi, wallet) as NodeRegistry
    const ssReg = new Contract(ssRegistryAddress, ssRegistryAbi, wallet) as StreamStorageRegistry

    const path = `/test-${Date.now()}`
    const streamId = wallet.address + path
    const tx1 = await streamReg.createStream(path, '{"partitions":1}')
    const tr1 = await tx1.wait()
    console.log('Stream %s registered, receipt: %s', streamId, tr1)

    const tx2 = await nodeReg.createOrUpdateNode(node.address, 'http://node.url')
    const tr2 = await tx2.wait()
    console.log('Node %s registered, receipt: %s', node.address, tr2)

    const tx3 = await ssReg.addStorageNode(streamId, node.address, {gasLimit: '1000000'})
    const tr3 = await tx3.wait()
    console.log('Storage node %s added to stream %s, receipt: %s', node.address, streamId, tr3)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

