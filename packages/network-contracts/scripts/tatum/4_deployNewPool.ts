// first register ens domain on mainnet
// scripts/deploy.js
import { JsonRpcProvider } from '@ethersproject/providers'
import { ethers, upgrades } from 'hardhat'
import { Wallet } from 'ethers'
import { Chains } from "@streamr/config"

import { BrokerPool, BrokerPoolFactory, IPoolExitPolicy, IPoolJoinPolicy, IPoolYieldPolicy, LinkToken } from '../../typechain'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require('debug')('streamr:deploy-tatum')
import * as fs from 'fs'
const config = Chains.load()['dev1']
const CHAINURL = config.rpcEndpoints[0].url
const chainProvider = new JsonRpcProvider(CHAINURL)
const localConfig = JSON.parse(fs.readFileSync('localConfig.json', 'utf8'))
let deploymentOwner: Wallet
let investor: Wallet
let poolFactory: BrokerPoolFactory
let pool: BrokerPool
let token: LinkToken

const connectToAllContracts = async () => {
    investor = Wallet.createRandom().connect(chainProvider)
    deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)
    await (await deploymentOwner.sendTransaction({
        to: investor.address,
        value: ethers.utils.parseEther('1')
    })).wait()

    const poolFactoryFactory = await ethers.getContractFactory('BrokerPoolFactory', deploymentOwner)
    const poolFactoryContact = await poolFactoryFactory.attach(localConfig.poolFactory) as BrokerPoolFactory
    poolFactory = await poolFactoryContact.connect(deploymentOwner) as BrokerPoolFactory

    const linkTokenFactory = await ethers.getContractFactory('LinkToken', deploymentOwner)
    const linkTokenFactoryTx = await linkTokenFactory.attach(localConfig.token)
    const linkTokenContract = await linkTokenFactoryTx.deployed()
    token = await linkTokenContract.connect(deploymentOwner) as LinkToken

    //send some tokens to investor
    await (await token.transfer(investor.address, ethers.utils.parseEther('100'))).wait()
}

const deployNewPool = async () => {
    const pooltx = await poolFactory.connect(deploymentOwner).deployBrokerPool(
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
    log('Pool deployed at: ', poolAddress)
    pool = await ethers.getContractAt('BrokerPool', poolAddress, investor) as BrokerPool
}

const investToPool = async () => {
    const tx = await token.connect(investor).transferAndCall(pool.address, ethers.utils.parseEther("1"),
        investor.address)
    await tx.wait()
    log('Invested to pool')
}

const stakeIntoBounty = async () => {
    const tx = await pool.connect(deploymentOwner).stake(localConfig.bounty, ethers.utils.parseEther("1"))
    await tx.wait()
    log('Staked into bounty')
}

const divestFromPool = async () => {
    const tx = await pool.connect(investor).queueDataPayout(ethers.utils.parseEther("1"))
    await tx.wait()
    log('Queued data payout')
}

const brokerUnstakesFromBounty = async () => {
    const tx = await pool.connect(deploymentOwner).unstake(localConfig.bounty)
    await tx.wait()
    log('Broker unstaked from bounty')
}

async function main() {
    await connectToAllContracts()
    await deployNewPool()
    await investToPool()
    // await stakeIntoBounty()
    // await divestFromPool()
    // await brokerUnstakesFromBounty()
    fs.writeFileSync('localConfig.json', JSON.stringify(localConfig, null, 2))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

