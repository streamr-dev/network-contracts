import { JsonRpcProvider } from "@ethersproject/providers"
import { Wallet } from "ethers"
import hhat from "hardhat"
import debug from "debug"
const log = debug("Streamr:eth-init")

const { ethers, upgrades } = hhat

// const chainURL = "http://10.200.10.1:8546"
// const privKeyStreamRegistry = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

// mumbai
// const chainURL = 'https://matic-mumbai.chainstacklabs.com/'
const chainURL = 'https://rpc-mumbai.maticvigil.com'
const privKeyStreamRegistry = "0x27e03eb2855d67f8cab10c97a2cf83c68f17d563efedd5df345b1c815c9ca936"
// const LINKTOKEN_ADDRESS = '0x326C977E6efc84E512bB9C30f76E30c160eD06FB' // mumbai
// const privKeyStreamRegistry = process.env.OCR_ADMIN_PRIVATEKEY || '' // also set DEBUG="*"

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
    const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV4", wallet)
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
        [streamRegistry.address, "0xF782C6C4A02f2c71BB8a1Db0166FAB40ea956818", "0xF90cB82a76492614D07B82a7658917f3aC811Ac1"], { kind: "uups" })
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

    await deployStreamRegistry()
}

main()
