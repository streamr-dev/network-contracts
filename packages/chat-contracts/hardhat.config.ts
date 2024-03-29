// import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import 'hardhat-typechain'
import { HardhatUserConfig } from 'hardhat/types'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import '@openzeppelin/hardhat-upgrades'
import 'hardhat-erc1820'

require('solidity-coverage')
require('hardhat-dependency-compiler')
require('@nomiclabs/hardhat-etherscan')

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
    dependencyCompiler: {
        paths: [
            '@openzeppelin/contracts/metatx/MinimalForwarder.sol',
            '@openzeppelin/contracts/token/ERC20/ERC20.sol',
            'contracts/TestTokens/ERC20TestToken.sol',
            '@openzeppelin/contracts/token/ERC721/ERC721.sol',
            'contracts/TestTokens/ERC721TestToken.sol',
            '@openzeppelin/contracts/token/ERC1155/ERC1155.sol',
            'contracts/TestTokens/ERC1155TestToken.sol',
            'contracts/DelegatedAccessRegistry.sol',
            'contracts/JoinPolicies/JoinPolicy.sol'
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
    namedAccounts: {
        deployer: 0,
    },
    typechain: {
        outDir: './typechain',
        target: 'ethers-v5',
    }
}
export default config
