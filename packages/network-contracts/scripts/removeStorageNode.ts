// Steps before running this file:
//   start dev env: streamr-docker-dev start graph-node
//   deploy in the localsidechain: npm run graph (in network-contracts directory!)

import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { getAddress } from "ethers/lib/utils"

// import type { StreamRegistry, NodeRegistry, StreamStorageRegistry } from '../typechain'
import type { StreamStorageRegistry } from "../typechain"

// import { address as streamRegistryAddress, abi as streamRegistryAbi } from '../deployments/localsidechain/StreamRegistry.json'
// import { address as nodeRegistryAddress, abi as nodeRegistryAbi } from '../deployments/localsidechain/NodeRegistry.json'
import { address as ssRegistryAddress, abi as ssRegistryAbi } from "../deployments/localsidechain/StreamStorageRegistry.json"

const SIDECHAINURL = "http://localhost:8546"
const DEFAULTPRIVATEKEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"

const {
    stream = "",
    node
} = process.env

if (!stream) { throw new Error("Missing streamId") }
const streamId = stream || ""
const nodeAddress = getAddress(node || "")

const provider = new JsonRpcProvider(SIDECHAINURL)
const wallet = new Wallet(DEFAULTPRIVATEKEY, provider)

async function main() {
    // const streamReg = new Contract(streamRegistryAddress, streamRegistryAbi, wallet) as StreamRegistry
    // const nodeReg = new Contract(nodeRegistryAddress, nodeRegistryAbi, wallet) as NodeRegistry
    const ssReg = new Contract(ssRegistryAddress, ssRegistryAbi, wallet) as StreamStorageRegistry

    const tx3 = await ssReg.removeStorageNode(streamId, nodeAddress)
    const tr3 = await tx3.wait()
    console.log("Storage node %s removed from stream %s, receipt: %s", nodeAddress, streamId, tr3)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

