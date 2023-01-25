// first register ens domain on mainnet
// scripts/deploy.js

import { ethers } from 'hardhat'
import { providers, Wallet } from 'ethers'
import { Chains } from "@streamr/config"

import { Bounty, BountyFactory, LinkToken } from '../../typechain'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require('debug')('streamr:deploy-tatum')
import * as fs from 'fs'
const config = Chains.load()['dev1']
const CHAINURL = config.rpcEndpoints[0].url
const localConfig = JSON.parse(fs.readFileSync('localConfig.json', 'utf8'))

const chainProvider = new providers.JsonRpcProvider(CHAINURL)

async function deployPoolFactory() {
    ... deploy all policy templates and pooltemplate then factory
    const deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)
    const poolFactoryFactory = await ethers.getContractFactory('PoolFactory', deploymentOwner)
    const poolFactory = await poolFactoryFactory.deploy()
    await poolFactory.deployed()
    log("PoolFactory deployed to:", poolFactory.address)
    return poolFactory.address
}

async function main() {
    await deployPoolFactory()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

