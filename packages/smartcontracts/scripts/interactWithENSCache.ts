// scripts/deploy.js
import hhat from 'hardhat'

// import { ENSCache } from '../typechain/ENSCache'

const { ethers } = hhat

async function main() {
    // deploy new main logic contract
    const ENSCacheFactory = await ethers.getContractFactory('ENSCache')
    // console.log('Deploying StreamRegistryTimeBased...')
    // const streamRegistryTimeBased = await StreamRegistryFactory.deploy() as StreamRegistryTimeBased
    // console.log('StreamRegistryTimeBased deployed to:', streamRegistryTimeBased.address)

    // deploy proxyAdmin contract
    const ensCacheaddr = '0x642D2B84A32A9A92FEc78CeAA9488388b3704898'
    // const ENSCachec = await ethers.getContractFactory('ProxyAdmin')
    // console.log('Attaching to ProxyAdmin...')
    const enscache = await ENSCacheFactory.attach(ensCacheaddr)
    const enscacheContract = await enscache.deployed()
    // console.log('Attached to ProxyAdmin:', proxyAdmin.address)
    // console.log('upgrading implementation:')
    const owner = await enscacheContract.owner()
    // const owner = "sdf"
    console.log('owner ', owner)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
