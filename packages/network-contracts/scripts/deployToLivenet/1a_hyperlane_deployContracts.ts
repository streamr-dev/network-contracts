import { JsonRpcProvider } from "@ethersproject/providers"
import { Wallet } from "ethers"
import hhat from "hardhat"
import debug from "debug"
const log = debug("Streamr:eth-init")

const { ethers, upgrades } = hhat

const chainURL = "http://10.200.10.1:8546"
const privKeyStreamRegistry = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

let nodeRegistryAddress = ""
let streamRegistryAddress = ""
let wallet: Wallet

async function deployStreamRegistry() {
    // log('Sending some Ether to chainlink node address')
    // const tx = await wallet.sendTransaction({
    //     to: chainlinkNodeAddress,
    //     value: parseEther('10')
    // })
    // await tx.wait()

    log("Deploying Streamregistry and chainlink contracts to sidechain:")


    log("deploying Streamregistry")
    const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV3", wallet)
    // const streamRegistryFactoryTx = await streamRegistryFactory.deploy(ensCache.address, constants.AddressZero)
    const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory,
        [Wallet.createRandom().address, Wallet.createRandom().address], { kind: "uups" })
    const streamRegistry = await streamRegistryFactoryTx.deployed()
    streamRegistryAddress = streamRegistry.address
    log(`Streamregistry deployed at ${streamRegistry.address}`)

    const role = await streamRegistry.TRUSTED_ROLE()
    log("granting role trusted role to deployer")
    const tx6 = await streamRegistry.grantRole(role, wallet.address)
    await tx6.wait()

    // hyperlane enscache
    log("deploying Hyperlane ENSCache")
    const ensCacheFactory2 = await ethers.getContractFactory("ENSCacheHyV1", wallet)
    const ensCacheFactoryTx2 = await upgrades.deployProxy(ensCacheFactory2,
        [streamRegistry.address, streamRegistry.address, streamRegistry.address], { kind: "uups" })
    const ensCache2 = await ensCacheFactoryTx2.deployed()
    log(`Hyperlane ENSCache deployed at ${ensCache2.address}`)
    log(`setting Hyperlane ENSCache address in Streamregistry`)
    const tx7 = await streamRegistry.setEnsCache(ensCache2.address)
    await tx7.wait()
    log("setting hyperlane enscache address as trusted role in streamregistry")
    const tx8 = await streamRegistry.grantRole(role, ensCache2.address)
    await tx8.wait()
    log("done setting hyperlane enscache address as trusted role in streamregistry")
    log("set streamregistry in enscache")
    const tx9 = await ensCache2.setStreamRegistry(streamRegistry.address)
    await tx9.wait()
    log("done set streamregistry in enscache")
}


async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    log(`wallet address ${wallet.address}`)
    const initialNodes: string[] = []
    const initialMetadata: string[] = []

    await deployStreamRegistry()
}

main()
