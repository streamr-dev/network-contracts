import { ethers, upgrades } from 'hardhat'
import { networks } from "@streamr-contracts/config"
import { parseUnits } from 'ethers/lib/utils'

// Polygon mainet
const STREAMSTORAGEREGISTRYADDRESS = networks.polygon.contracts.StreamStorageRegistry
const DEPLOYMENT_OWNER_KEY = process.env.OCR_ADMIN_PRIVATEKEY || ''

// localsidechain
// const DEPLOYMENT_OWNER_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'
// const STREAMSTORAGEREGISTRYADDRESS = networks.dev1.contracts.StreamStorageRegistry
// const STREAMSTORAGEREGISTRYADDRESS = '0xd57E7d0915c117A1510546b48f6beC551FDa9B93'

// async function forceImport() {
//     const streamStorageRegistryFactory = await ethers.getContractFactory('StreamStorageRegistry')
//     await upgrades.forceImport(STREAMSTORAGEREGISTRYADDRESS, 
//         streamStorageRegistryFactory, {kind: 'uups'})
//     console.log('StreamStorageRegistry imported, check file in .openzeppelin')
// }

async function main() {
    // await forceImport()

    const deploymentOwner = new ethers.Wallet(DEPLOYMENT_OWNER_KEY, ethers.provider)
    deploymentOwner.getFeeData = async() => {
        console.log('##########################')
        return { maxFeePerGas: parseUnits("500", "gwei"), maxPriorityFeePerGas: parseUnits("50", "gwei"), gasPrice: parseUnits("200", "gwei") }
    }
    const streamstorageregistryFactoryV2 = await ethers.getContractFactory('StreamStorageRegistryV2', deploymentOwner)
    console.log('upgrading StreamStorageregistry: proxyaddress: ' + STREAMSTORAGEREGISTRYADDRESS)
    const streamStorageRegistryUpgraded = await upgrades.upgradeProxy(STREAMSTORAGEREGISTRYADDRESS, streamstorageregistryFactoryV2, {kind: 'uups'})
    console.log('streamstorageregistry upgraded, address is (should be same): ' + streamStorageRegistryUpgraded.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

