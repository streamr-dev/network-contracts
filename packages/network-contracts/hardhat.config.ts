import "@nomicfoundation/hardhat-toolbox"
import "@nomicfoundation/hardhat-chai-matchers"
import { HardhatUserConfig } from 'hardhat/types'
import '@openzeppelin/hardhat-upgrades'
import 'hardhat-ignore-warnings'
import 'solidity-coverage'
import 'hardhat-dependency-compiler'
import '@nomiclabs/hardhat-etherscan'
// import "hardhat-gas-reporter"

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
declare module 'hardhat/types/config' {
    interface HardhatUserConfig {
      dependencyCompiler?: any;
    }
}

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {

    defaultNetwork: 'hardhat',
    networks: {
        hardhat: {
            gas: 12000000,
            blockGasLimit: 0x1fffffffffffff,
            allowUnlimitedContractSize: true
        },
        dev1: {
            chainId: 8997,
            url: "http://localhost:8546",
            accounts: ["0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"]
        },
        dev0: {
            chainId: 8995,
            url: "http://localhost:8545",
            accounts: ["0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"]
        },
        gnosis: {
            chainId: 100,
            url: "https://rpc.gnosischain.com",
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        },
        polygon: {
            chainId: 137,
            url: "https://polygon-rpc.com",
            // gasPrice: 80000000000,
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        },
        ethereum: {
            chainId: 1,
            url: "https://mainnet.infura.io/v3/" + process.env.INFURA_KEY || "",
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        }
    },
    etherscan: {
        apiKey: ''
    },
    dependencyCompiler: {
        paths: [
            '@openzeppelin/contracts/metatx/MinimalForwarder.sol',
            '@chainlink/contracts/src/v0.4/LinkToken.sol',
            '@chainlink/contracts/src/v0.6/Oracle.sol',
            '@opengsn/contracts/src/forwarder/Forwarder.sol',
            '@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol',
            '@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol',
            '@openzeppelin/contracts-upgradeable/metatx/MinimalForwarderUpgradeable.sol',
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
    },
    // gasReporter: {
    //     enabled: true,
    // },
    // namedAccounts: { // 224126
    //     deployer: 0,
    // },
    warnings: {
        '@chainlink/contracts/src/v0.4/**/*': {
            default: 'off',
        },
    },
    typechain: {
        outDir: './typechain',
        target: 'ethers-v5',
    },
    mocha: {
        timeout: 100000000
    }
}
export default config
