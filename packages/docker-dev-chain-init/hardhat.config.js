// import { task } from 'hardhat/config'
// import '@nomiclabs/hardhat-waffle'
// import 'hardhat-typechain'
// import { HardhatUserConfig } from 'hardhat/types'
// import 'hardhat-deploy'
// import 'hardhat-deploy-ethers'
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
        localmainchain: {
            chainId: 8995,
            url: "http://10.200.10.1:8545",
            accounts: ['0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0']
        },
        polygonTestMumbai1: {
            chainId: 80001,
            url: 'https://rpc-mumbai.maticvigil.com',
            // accounts: ['0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae']
        },
        polygonTestMumbai2: {
            chainId: 80001,
            url: 'https://matic-mumbai.chainstacklabs.com/',
            // accounts: ['0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae']
        },
        polygonMainnet: {
            chainId: 137,
            url: 'https://polygon-rpc.com',
        }
    },
    dependencyCompiler: {
        paths: [
            '@streamr-contracts/network-contracts/contracts/NodeRegistry/NodeRegistry.sol',
            '@streamr-contracts/network-contracts/contracts/NodeRegistry/TrackerRegistry.sol',
            '@streamr-contracts/network-contracts/contracts/StreamRegistry/StreamRegistryV3.sol',
            '@streamr-contracts/network-contracts/contracts/StreamStorageRegistry/StreamStorageRegistry.sol',
            '@dataunions/contracts/contracts/DataUnionFactory.sol',
            '@dataunions/contracts/contracts/DataUnionTemplate.sol',
            '@dataunions/contracts/contracts/DefaultFeeOracle.sol',
            '@openzeppelin/contracts-upgradeable/metatx/MinimalForwarderUpgradeable.sol',
            '@chainlink/contracts/src/v0.4/LinkToken.sol',
            '@chainlink/contracts/src/v0.6/Oracle.sol',
            '@streamr-contracts/hub-contracts/contracts/MarketplaceV3.sol',
            '@streamr-contracts/hub-contracts/contracts/MarketplaceV4.sol',
            '@streamr-contracts/hub-contracts/contracts/Uniswap2Adapter.sol',
            '@streamr-contracts/hub-contracts/contracts/ProjectRegistry/ProjectRegistry.sol'
        ],
    },
    solidity: {
        compilers: [
            {
                version: '0.8.13',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
            {
                version: '0.8.9',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
            {
                version: '0.8.6',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: '0.6.6',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
            {
                version: '0.4.24',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
            {
                version: '0.6.12',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            }],
    }
}