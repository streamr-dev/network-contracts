// first register ens domain on mainnet
// scripts/deploy.js
import { JsonRpcProvider } from "@ethersproject/providers"
import { ethers, upgrades } from "hardhat"
import { Wallet } from "ethers"
import { Chains } from "@streamr/config"

import { BrokerPool, BrokerPoolFactory, IPoolExitPolicy, IPoolJoinPolicy, IPoolYieldPolicy, StreamrConstants } from "../../typechain"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")
import * as fs from "fs"
const config = Chains.load()["dev1"]
const CHAINURL = config.rpcEndpoints[0].url
const chainProvider = new JsonRpcProvider(CHAINURL)
const localConfig = JSON.parse(fs.readFileSync("localConfig.json", "utf8"))
let deploymentOwner: Wallet

async function deployPoolFactory() {
    const poolTemplate = await (await ethers.getContractFactory("BrokerPool")).deploy() as BrokerPool
    await poolTemplate.deployed()
    log("Deployed pool template", poolTemplate.address)
    const defaultPoolJoinPolicy = await (await ethers.getContractFactory("DefaultPoolJoinPolicy",
        { signer: deploymentOwner })).deploy() as IPoolJoinPolicy
    await defaultPoolJoinPolicy.deployed()
    localConfig.defaultPoolJoinPolicy = defaultPoolJoinPolicy.address
    log("Deployed default pool join policy", defaultPoolJoinPolicy.address)
    const defaultPoolYieldPolicy = await (await ethers.getContractFactory("DefaultPoolYieldPolicy",
        { signer: deploymentOwner })).deploy() as IPoolYieldPolicy
    await defaultPoolYieldPolicy.deployed()
    localConfig.defaultPoolYieldPolicy = defaultPoolYieldPolicy.address
    log("Deployed default pool yield policy", defaultPoolYieldPolicy.address)
    const defaultPoolExitPolicy = await (await ethers.getContractFactory("DefaultPoolExitPolicy",
        { signer: deploymentOwner })).deploy() as IPoolExitPolicy
    await defaultPoolExitPolicy.deployed()
    localConfig.defaultPoolExitPolicy = defaultPoolExitPolicy.address
    log("Deployed default pool exit policy", defaultPoolExitPolicy.address)

    const poolFactoryFactory = await ethers.getContractFactory("BrokerPoolFactory",
        { signer: deploymentOwner })
    const poolFactory = await upgrades.deployProxy(poolFactoryFactory, [
        poolTemplate.address,
        localConfig.token,
        localConfig.streamrConstants
    ]) as BrokerPoolFactory
    // eslint-disable-next-line require-atomic-updates
    // localConfig.poolFactory = poolFactory.address
    await poolFactory.deployed()
    log("Deployed pool factory", poolFactory.address)
    // eslint-disable-next-line require-atomic-updates
    localConfig.poolFactory = poolFactory.address
    await (await poolFactory.addTrustedPolicies([
        defaultPoolJoinPolicy.address,
        defaultPoolYieldPolicy.address,
        defaultPoolExitPolicy.address,
    ])).wait()
    log("Added trusted policies")

    const streamrConstantsFactory = await ethers.getContractFactory("StreamrConstants", { signer: deploymentOwner })
    const streamrConstants = await streamrConstantsFactory.attach(localConfig.streamrConstants) as StreamrConstants
    await (await streamrConstants.setBrokerPoolFactory(poolFactory.address)).wait()
    log("Set broker pool factory in StreamrConstants")
}

async function main() {
    deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)
    await deployPoolFactory()
    fs.writeFileSync("localConfig.json", JSON.stringify(localConfig, null, 2))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
