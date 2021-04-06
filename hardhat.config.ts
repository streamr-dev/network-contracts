import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import 'hardhat-typechain'
import { HardhatUserConfig } from 'hardhat/types'

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (args, hre) => {
    const accounts = await hre.ethers.getSigners()
    // eslint-disable-next-line no-restricted-syntax
    for (const account of accounts) {
        console.log(account.address)
    }
})

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {

    defaultNetwork: 'hardhat',
    networks: {
        hardhat: {},
        dev: {
            url: 'http://0.0.0.0:8545',
            accounts: ['0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb']
        }
    },
    solidity: {
        compilers: [{
            version: '0.7.6', settings: {}
        }],
    },
    typechain: {
        outDir: './typechain',
        target: 'ethers-v5',
    }
}
export default config

