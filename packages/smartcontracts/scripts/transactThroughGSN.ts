// scripts/deploy.js
import { ethers } from 'hardhat'
import { RelayProvider } from '@opengsn/provider'

// import { StreamRegistryV4 } from '../typechain/StreamRegistryV4'
// import { ExternalProvider } from '@ethersproject/providers'
// import * as Web3HttpProvider from 'web3-providers-http'
import HttpProvider from 'web3-providers-http'

// const log = console.log
const FORWARDER = "0xdA78a11FD57aF7be2eDD804840eA7f4c2A38801d"
const PAYMASTER = "0x43E69adABC664617EB9C5E19413a335e9cd4A243"
const STREAMREGISTRY = "0x0D483E10612F327FC11965Fc82E90dC19b141641"
// const STORAGEREGISTRY = "0xe8e2660CeDf2a59C917a5ED05B72df4146b58399"

async function main() {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore web3-providers-http lies about its types: it exports HttpProvider and not { HttpProvider }
    const web3provider = new HttpProvider('https://polygon-rpc.com/')
    // const web3provider = new Web3HttpProvider(process.env.POLYGON_RPC_URL)

    const streamRegistryFactoryV4 = await ethers.getContractFactory('StreamRegistryV4')
    let registry = await streamRegistryFactoryV4.attach(STREAMREGISTRY)
    registry = await registry.deployed()

    // const streamStorageRegistryFactoryV2 = await ethers.getContractFactory('StreamStorageRegistryV2')
    // let storageRegistry = await streamStorageRegistryFactoryV2.attach(STORAGEREGISTRY)
    // storageRegistry = await storageRegistry.deployed()

    const config = {
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
    const gsnWeb3Provider = RelayProvider.newProvider({ provider: web3provider, config })
    await gsnWeb3Provider.init()

    // patch the GSN class so that it works nicely with ethers.js (it's made for web3.js, BOOO!)
    const gsnContractInteractor = gsnWeb3Provider.relayClient.dependencies.contractInteractor
    const gsnOriginalGetter = gsnContractInteractor.getMaxViewableGasLimit
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore We're deliberately patching it to return a string, while the type says BN
    gsnContractInteractor.getMaxViewableGasLimit = (...args) => gsnOriginalGetter.apply(gsnContractInteractor, args).then((x) => x.toString())

    const gsnProvider = new ethers.providers.Web3Provider(gsnWeb3Provider)

    // empty account, no eth, no gas
    const account = new ethers.Wallet('0x52090fc090bd60b26f8e907287d1b5a02105d5b59d1f6840f32a4cbadf81810d', gsnProvider)
    gsnWeb3Provider.addAccount(account.privateKey)

    // getSigner produces a JsonRpcSigner which apparently works differently from Wallet
    const registryThroughGSN = registry.connect(gsnProvider.getSigner(account.address))
    await registryThroughGSN.createStream("/samgsntest1", "metadata")
    // await registryThroughGSN.deleteStream("0x9cdfd342181b6b6bfc350f3f96a44aad499d0536/samgsntest1")

    // const storageRegistryThroughGSN = storageRegistry.connect(etherProvider.getSigner(from)) as StreamStorageRegistryV2
    // await storageRegistryThroughGSN.addStorageNode(
    //     "0x9cdfd342181b6b6bfc350f3f96a44aad499d0536/samgsntest1",
    //     "0x9cdfd342181b6b6bfc350f3f96a44aad499d0536"
    // )
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
