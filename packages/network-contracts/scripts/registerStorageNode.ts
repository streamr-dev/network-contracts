// Steps before running this file:
//   start dev env: streamr-docker-dev start graph-node
//   deploy in the localsidechain: npm run graph (in network-contracts directory!)

import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"

import type { StreamRegistry, NodeRegistry, StreamStorageRegistry } from "@streamr/network-contracts"

import { address as streamRegistryAddress, abi as streamRegistryAbi } from "../deployments/localsidechain/StreamRegistry.json"
import { address as nodeRegistryAddress, abi as nodeRegistryAbi } from "../deployments/localsidechain/NodeRegistry.json"
import { address as ssRegistryAddress, abi as ssRegistryAbi } from "../deployments/localsidechain/StreamStorageRegistry.json"

const SIDECHAINURL = "http://localhost:8546"
const DEFAULTPRIVATEKEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"

const provider = new JsonRpcProvider(SIDECHAINURL)
const wallet = new Wallet(DEFAULTPRIVATEKEY, provider)
const node = Wallet.createRandom()

async function main() {
    const streamReg = new Contract(streamRegistryAddress, streamRegistryAbi, wallet) as StreamRegistry
    const nodeReg = new Contract(nodeRegistryAddress, nodeRegistryAbi, wallet) as NodeRegistry
    const ssReg = new Contract(ssRegistryAddress, ssRegistryAbi, wallet) as StreamStorageRegistry

    const path = `/test-${Date.now()}`
    const streamId = wallet.address.toLowerCase() + path
    const tx1 = await streamReg.createStream(path, "{\"partitions\":1}")
    const tr1 = await tx1.wait()
    console.log("Stream %s registered, tx: %s", streamId, tr1.transactionHash)

    const tx2 = await nodeReg.createOrUpdateNode(node.address, "http://node.url")
    const tr2 = await tx2.wait()
    console.log("Node %s registered, tx: %s", node.address, tr2.transactionHash)

    // const metadata = await streamReg.streamIdToMetadata(streamId)
    // console.log("metadata", metadata)
    // const nodeInfo = await nodeReg.getNode(node.address)
    // console.log("node info", nodeInfo)
    // const perms = await streamReg.getPermissionsForUser(streamId, wallet.address)
    // console.log("perms", perms)
    // enum PermissionType { Edit, Delete, Publish, Subscribe, Share }
    // const canEdit = await streamReg.hasPermission(streamId, wallet.address, PermissionType.Edit)
    // console.log("canEdit", canEdit)

    const tx3 = await ssReg.addStorageNode(streamId, node.address, { gasLimit: "1000000" })
    const tr3 = await tx3.wait()
    console.log("Storage node %s added to stream %s, tx: %s", node.address, streamId, tr3.transactionHash)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

