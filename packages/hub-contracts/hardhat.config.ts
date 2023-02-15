import { HardhatUserConfig } from "hardhat/types"

import 'hardhat-typechain'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@openzeppelin/hardhat-upgrades'

import "solidity-coverage"
require('hardhat-dependency-compiler')
require('dotenv').config()

declare module 'hardhat/types/config' {
    interface HardhatUserConfig {
      dependencyCompiler?: any;
    }
}

const config: HardhatUserConfig = {
    dependencyCompiler: {
        paths: [
            '@openzeppelin/contracts/metatx/MinimalForwarder.sol',
            '@streamr-contracts/network-contracts/contracts/StreamRegistry/StreamRegistryV3.sol',
        ],
    },
    solidity: {
        compilers: [
            {
                version: "0.8.9", // used for most sources
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    evmVersion: "istanbul",
                }
            },
            {
                version: "0.8.13", // used for RemoteMarketplace since encodeCall is not supported in 0.8.9
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    evmVersion: "istanbul",
                }
            }
        ],
    },
    networks: {
        hardhat: {},
        dev0: {
            chainId: 8995,
            url: "http://localhost:8545",
            accounts: ["0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"]
        },
        dev1: {
            chainId: 8997,
            url: "http://localhost:8546",
            accounts: ["0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"]
        },
        gnosis: {
            chainId: 100,
            url: "https://rpc.gnosischain.com/",
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        },
        polygon: {
            chainId: 137,
            url: 'https://polygon-rpc.com',
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        },
        mumbai: {
            chainId: 80001,
            url: 'https://rpc-mumbai.maticvigil.com/v1/' + process.env.MATIC_KEY || "",
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        },
        arbitrum: {
            chainId: 42161,
            url: 'https://arb1.arbitrum.io/rpc',
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        },
        ethereum: {
            chainId: 1,
            url: "https://mainnet.infura.io/v3/" + process.env.INFURA_KEY || "",
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        },
        goerli: {
            chainId: 5,
            url: "https://goerli.infura.io/v3/" + process.env.INFURA_KEY || "",
            accounts: [process.env.KEY || "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"] // dummy key
        }
    },
    typechain: {
        outDir: "./typechain",
        target: "ethers-v5",
    }
}
export default config
