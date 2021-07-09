import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import 'hardhat-typechain'
import { HardhatUserConfig } from 'hardhat/types'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'

require('solidity-coverage')

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (args, hre) => {
    const accounts = await hre.ethers.getSigners()
    // eslint-disable-next-line no-restricted-syntax
    for (const account of accounts) {
        // eslint-disable-next-line no-console
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
        localsidechain: {
            chainId: 8997,
            url: 'http://localhost:8546'
        }
    },
    solidity: {
        compilers: [
            {
                version: '0.8.6',
                settings: { }
            },
            {
                version: '0.7.4',
                settings: { }
            },
            {
                version: '0.6.6',
                settings: { }
            },
            {
                version: '0.6.12',
                settings: { }
            }],
        overrides: {
            'contracts/chainlinkClient/ESNCache.sol': {
                version: '0.7.6',
                settings: { }
            },
            'contracts/chainlinkClient/Token.sol': {
                version: '0.6.6',
                settings: { }
            },
            // 'contracts/chainlinkClient/Context.sol': {
            //     version: '0.6.12',
            //     settings: { }
            // }
        }
    },
    namedAccounts: {
        deployer: 0,
    },
    typechain: {
        outDir: './typechain',
        target: 'ethers-v5',
    }
}
export default config

