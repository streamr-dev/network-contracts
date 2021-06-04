// scripts/deploy.js
import hhat from 'hardhat'

import { StreamRegistryTimeBased } from '../typechain/StreamRegistryTimeBased'

const { ethers } = hhat

async function main() {
    // deploy new main logic contract
    const StreamRegistryFactory = await ethers.getContractFactory('StreamRegistryTimeBased')
    console.log('Deploying StreamRegistryTimeBased...')
    const streamRegistryTimeBased = await StreamRegistryFactory.deploy() as StreamRegistryTimeBased
    console.log('StreamRegistryTimeBased deployed to:', streamRegistryTimeBased.address)

    // deploy proxyAdmin contract
    const proxyAdminAddr = '0xfF3480127F32e681b571446681cF960a6751C533'
    const proxyAddr = '0x834577403026D0e05bbeb7c53D27B7E4FfE63b89'
    const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin')
    console.log('Attaching to ProxyAdmin...')
    let proxyAdmin = await ProxyAdmin.attach(proxyAdminAddr)
    proxyAdmin = await proxyAdmin.deployed()
    console.log('Attached to ProxyAdmin:', proxyAdmin.address)
    console.log('upgrading implementation:')
    await proxyAdmin.upgrade(proxyAddr, streamRegistryTimeBased.address)
    console.log('upgraded proxy at ', proxyAddr, ' to implementation ', streamRegistryTimeBased.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
