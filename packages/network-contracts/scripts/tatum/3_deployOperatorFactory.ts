// first register ens domain on mainnet
// scripts/deploy.js
import { JsonRpcProvider } from "@ethersproject/providers"
import { ethers, upgrades } from "hardhat"
import { Wallet } from "ethers"
import { config } from "@streamr/config"

import { Operator, OperatorFactory, IUndelegationPolicy, IDelegationPolicy, IExchangeRatePolicy, StreamrConfig } from "../../typechain"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")
import * as fs from "fs"
const CHAINURL = config.dev1.rpcEndpoints[0].url
const chainProvider = new JsonRpcProvider(CHAINURL)
const localConfig = JSON.parse(fs.readFileSync("localConfig.json", "utf8"))
let deploymentOwner: Wallet

async function deployOperatorFactory() {
    const operatorTemplate = await (await ethers.getContractFactory("Operator")).deploy() as Operator
    await operatorTemplate.deployed()
    log("Deployed Operator contract template", operatorTemplate.address)
    const defaultDelegationPolicy = await (await ethers.getContractFactory("DefaultDelegationPolicy",
        { signer: deploymentOwner })).deploy() as IDelegationPolicy
    await defaultDelegationPolicy.deployed()
    localConfig.defaultDelegationPolicy = defaultDelegationPolicy.address
    log("Deployed default Operator contract delegation policy", defaultDelegationPolicy.address)
    const defaultExchangeRatePolicy = await (await ethers.getContractFactory("DefaultExchangeRatePolicy",
        { signer: deploymentOwner })).deploy() as IExchangeRatePolicy
    await defaultExchangeRatePolicy.deployed()
    localConfig.defaultExchangeRatePolicy = defaultExchangeRatePolicy.address
    log("Deployed defaultExchangeRatePolicy", defaultExchangeRatePolicy.address)
    const defaultUndelegationPolicy = await (await ethers.getContractFactory("DefaultUndelegationPolicy",
        { signer: deploymentOwner })).deploy() as IUndelegationPolicy
    await defaultUndelegationPolicy.deployed()
    localConfig.defaultUndelegationPolicy = defaultUndelegationPolicy.address
    log("Deployed default Operator contract undelegation policy", defaultUndelegationPolicy.address)

    const operatorFactoryFactory = await ethers.getContractFactory("OperatorFactory",
        { signer: deploymentOwner })
    const operatorFactory = await upgrades.deployProxy(operatorFactoryFactory, [
        operatorTemplate.address,
        localConfig.token,
        localConfig.streamrConfig
    ], {kind: "uups", unsafeAllow: ["delegatecall"]}) as unknown as OperatorFactory
    // eslint-disable-next-line require-atomic-updates
    // localConfig.operatorFactory = operatorFactory.address
    await operatorFactory.deployed()
    log("Deployed Operator contract factory", operatorFactory.address)
    // eslint-disable-next-line require-atomic-updates
    localConfig.operatorFactory = operatorFactory.address
    await (await operatorFactory.addTrustedPolicies([
        defaultDelegationPolicy.address,
        defaultExchangeRatePolicy.address,
        defaultUndelegationPolicy.address,
    ])).wait()
    log("Added trusted policies")

    const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", { signer: deploymentOwner })
    const streamrConfig = await streamrConfigFactory.attach(localConfig.streamrConfig) as StreamrConfig
    await (await streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
    log("Set Operator contract factory in StreamrConfig")
}

/** npx hardhat run --network dev1 scripts/tatum/3_deployOperatorFactory.ts */
async function main() {
    deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)
    await deployOperatorFactory()
    fs.writeFileSync("localConfig.json", JSON.stringify(localConfig, null, 2))
    log("Wrote operator factory and related contracts to local config")
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

