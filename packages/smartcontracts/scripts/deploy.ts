// scripts/deploy.js
import hhat from 'hardhat'

const { ethers } = hhat

async function main() {
    const StreamRegistry = await ethers.getContractFactory('StreamRegistry')
    console.log('Deploying StreamRegistry...')
    const streamRegistry = await StreamRegistry.deploy('0x2fb7Cd141026fcF23Abb07593A14D6E45dC33D54')
    console.log('StreamRegistry deployed to:', streamRegistry.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
