// import { task } from 'hardhat/config'
// import '@nomiclabs/hardhat-waffle'
import 'hardhat-typechain'
// import { HardhatUserConfig } from 'hardhat/types'
// import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
require('@openzeppelin/hardhat-upgrades')

// require('solidity-coverage')
require('hardhat-dependency-compiler')

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
// task('accounts', 'Prints the list of accounts', async (args, hre) => {
//     const accounts = await hre.ethers.getSigners()
//     // eslint-disable-next-line no-restricted-syntax
//     for (const account of accounts) {
//         // eslint-disable-next-line no-console
//         console.log(account.address)
//     }
// })

// TODO: add this to the hardhat-dependency-compiler repo as a pull request or whatever
// declare module 'hardhat/types/config' {
//     interface HardhatUserConfig {
//       dependencyCompiler?: any;
//     }
// }

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

module.exports = {

    defaultNetwork: 'hardhat',
    networks: {
        hardhat: {
            gas: 12000000,
            blockGasLimit: 0x1fffffffffffff,
            allowUnlimitedContractSize: true
        },
        localsidechain: {
            chainId: 8997,
            url: 'http://10.200.10.1:8546',
            accounts: ['0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0']
        },
        polygonMainnet: {
            chainId: 137,
            // url: 'https://polygon-rpc.com',
            url: 'https://wild-dark-thunder.matic.quiknode.pro/08b0fa6254499defc975c381ee21777cb197fac5/',
        }
    },
    dependencyCompiler: {
        paths: [
            '@streamr/network-contracts/contracts/StreamRegistry/StreamRegistryV3.sol'
        ],
    },
    solidity: {
        compilers: [
            {
                version: '0.8.9',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            }],
    },
    typechain: {
        outDir: './typechain',
        target: 'ethers-v5',
    }
}