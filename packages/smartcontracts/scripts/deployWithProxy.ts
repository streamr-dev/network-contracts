// scripts/deploy.js
import hhat from 'hardhat'

import { StreamRegistry } from '../typechain/StreamRegistry'

const { ethers } = hhat

async function main() {
    // deploy main logic contract
    const StreamRegistryFactory = await ethers.getContractFactory('StreamRegistry')
    console.log('Deploying StreamRegistry...')
    const streamRegistry = await StreamRegistryFactory.deploy() as StreamRegistry
    console.log('StreamRegistry deployed to:', streamRegistry.address)

    // deploy proxyAdmin contract
    const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin')
    console.log('Deploying ProxyAdmin...')
    const proxyAdmin = await ProxyAdmin.deploy()
    console.log('ProxyAdmin deployed to:', proxyAdmin.address)

    // deploy proxy contract
    const TransparentUpgradeableProxy = await ethers.getContractFactory('TransparentUpgradeableProxy')
    console.log('Deploying StreamRegistry Proxy...')
    const transparentUpgradeableProxy = await TransparentUpgradeableProxy
        .deploy(streamRegistry.address, proxyAdmin.address, [])
    console.log('StreamRegistry Proxy deployed to:', transparentUpgradeableProxy.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
