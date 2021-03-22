// scripts/deploy.js
import hhat from 'hardhat'

const { ethers } = hhat

async function main() {
    const StreamRegistry = await ethers.getContractFactory('StreamRegistry')
    console.log('Deploying StreamRegistry...')
    const streamRegistry = await StreamRegistry.deploy()
    console.log('StreamRegistry deployed to:', streamRegistry.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
