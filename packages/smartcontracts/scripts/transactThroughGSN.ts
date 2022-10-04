// scripts/deploy.js
import { ethers } from 'hardhat'
import { RelayProvider } from '@opengsn/provider'

import { StreamRegistryV4 } from '../typechain/StreamRegistryV4'
import { ExternalProvider } from '@ethersproject/providers'
const Web3HttpProvider = require( 'web3-providers-http')


const log = console.log
const FORWARDER = "0xdA78a11FD57aF7be2eDD804840eA7f4c2A38801d"
const PAYMASTER = "0x43E69adABC664617EB9C5E19413a335e9cd4A243"
const STREAMREGISTRY = "0x0D483E10612F327FC11965Fc82E90dC19b141641"
const STORAGEREGISTRY = "0xe8e2660CeDf2a59C917a5ED05B72df4146b58399"

async function main() {
    const web3provider = new Web3HttpProvider('https://polygon-rpc.com/')
    // const web3provider = new Web3HttpProvider(process.env.POLYGON_RPC_URL)
 
        const streamRegistryFactoryV4 = await ethers.getContractFactory('StreamRegistryV4')
        let registry = await streamRegistryFactoryV4.attach(STREAMREGISTRY)
        registry = await registry.deployed()

        const streamStorageRegistryFactoryV2 = await ethers.getContractFactory('StreamStorageRegistryV2')
        let storageRegistry = await streamStorageRegistryFactoryV2.attach(STORAGEREGISTRY)
        storageRegistry = await storageRegistry.deployed()

        const config = await {
            // loggerConfiguration: { logLevel: 'error'},
            forwarderAddress: FORWARDER,
            paymasterAddress: PAYMASTER,
            // loggerConfiguration: {
            //     logLevel: 'debug'
            // },
            preferredRelays: ['https://gsn.streamr.network/gsn1'],
            relayLookupWindowBlocks: 9000,
            relayRegistrationLookupBlocks: 9000,
            pastEventsQueryMaxPageSize: 9000,
            auditorsCount: 0
        }
        let gsnProvider = RelayProvider.newProvider({provider: web3provider, config})
    	await gsnProvider.init()

        // empty account, no eth, no gas
    	const account = new ethers.Wallet('0x52090fc090bd60b26f8e907287d1b5a02105d5b59d1f6840f32a4cbadf81810d')
        gsnProvider.addAccount(account.privateKey)
    	const from = account.address

        const gsnProviderExternal = gsnProvider as unknown as ExternalProvider

        const etherProvider = new ethers.providers.Web3Provider(gsnProviderExternal)

        const registryThroughGSN = registry.connect(etherProvider.getSigner(from)) as StreamRegistryV4
        await registryThroughGSN.createStream("/samgsntest1", "metadata")
        // await registryThroughGSN.deleteStream("0x9cdfd342181b6b6bfc350f3f96a44aad499d0536/samgsntest3")


        // const storageRegistryThroughGSN = storageRegistry.connect(etherProvider.getSigner(from)) as StreamStorageRegistryV2
        // await storageRegistryThroughGSN.addStorageNode("0x9cdfd342181b6b6bfc350f3f96a44aad499d0536/samgsntest1", "0x9cdfd342181b6b6bfc350f3f96a44aad499d0536")
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
