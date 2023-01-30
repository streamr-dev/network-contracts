// first register ens domain on mainnet
// scripts/deploy.js
import { JsonRpcProvider } from '@ethersproject/providers'
import { ethers, upgrades } from 'hardhat'
import { Wallet } from 'ethers'
import { Chains } from "@streamr/config"

import { BrokerPool, BrokerPoolFactory, IPoolExitPolicy, IPoolJoinPolicy, IPoolYieldPolicy } from '../../typechain'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require('debug')('streamr:deploy-tatum')
import * as fs from 'fs'
const config = Chains.load()['dev1']
const CHAINURL = config.rpcEndpoints[0].url
const chainProvider = new JsonRpcProvider(CHAINURL)
const localConfig = JSON.parse(fs.readFileSync('localConfig.json', 'utf8'))
let deploymentOwner: Wallet
let userWallet: Wallet
let poolFactory: BrokerPoolFactory
let pool: BrokerPool

const connectToAllContracts = async () => {
    userWallet = Wallet.createRandom().connect(chainProvider)
    deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)
    await (await deploymentOwner.sendTransaction({
        to: userWallet.address,
        value: ethers.utils.parseEther('1')
    })).wait()

    const poolFactoryFactory = await ethers.getContractFactory('BrokerPoolFactory', deploymentOwner)
    const poolFactoryContact = await poolFactoryFactory.attach(localConfig.poolFactory) as BrokerPoolFactory
    poolFactory = await poolFactoryContact.connect(deploymentOwner) as BrokerPoolFactory
}

const deployNewPool = async () => {
    const pooltx = await poolFactory.connect(userWallet).deployBrokerPool(
        0, // min initial investment
        2592000, // 30 days grace period
        `Pool-${Date.now()}`,
        [localConfig.defaultPoolJoinPolicy, localConfig.defaultPoolYieldPolicy, localConfig.defaultPoolExitPolicy],
        [0, 0, 0, 0, 0, 10, 10, 0]
    )
    const poolReceipt = await pooltx.wait()
    const poolAddress = poolReceipt.events?.find((e: any) => e.event === 'NewBrokerPool')?.args?.poolAddress
    // eslint-disable-next-line require-atomic-updates
    localConfig.pool = poolAddress
}

async function main() {
    await connectToAllContracts()
    await deployNewPool()
    fs.writeFileSync('localConfig.json', JSON.stringify(localConfig, null, 2))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

