import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import 'hardhat-typechain'
import { HardhatUserConfig } from 'hardhat/types'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import '@openzeppelin/hardhat-upgrades'

require('solidity-coverage')
require('hardhat-dependency-compiler')

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
        localsidechain: {
            chainId: 8997,
            url: 'http://localhost:8546',
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
            '@openzeppelin/contracts-upgradeable/metatx/MinimalForwarderUpgradeable.sol',
            '@chainlink/contracts/src/v0.4/LinkToken.sol',
            '@chainlink/contracts/src/v0.6/Oracle.sol'
        ],
    },
    solidity: {
        compilers: [
            {
                version: '0.8.6',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
            {
                version: '0.7.4',
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
        // overrides: {
        // 'contracts/chainlinkClient/ESNCache.sol': {
        //     version: '0.7.6',
        //     settings: { }
        // },
        // 'contracts/chainlinkOracle/OracleImport.sol': {
        //     version: '0.6.6',
        //     settings: { }
        // },
        // 'contracts/chainlinkOracle/LinkTolenImport.sol': {
        //     version: '0.4.24',
        //     settings: { }
        // },
        // 'contracts/chainlinkClient/Context.sol': {
        //     version: '0.6.12',
        //     settings: { }
        // }
        // }
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

Streamr:eth-init wallet address 0xdC353aA3d81fC3d67Eb49F443df258029B01D8aB +0ms
Streamr:eth-init NodeRegistry deployed at 0x64A04452995DfFFf1756190098EeB0F5786Eff53 +11s
Streamr:eth-init NodeRegistry nodes : [["0xde1112f631486CfC759A50196853011528bC5FA0","{\"http\": \"http://10.200.10.1:8891/api/v1\"}",{"type":"BigNumber","hex":"0x61dc0bdc"}]] +647ms
Streamr:eth-init Deploying Streamregistry and chainlink contracts to sidechain: +0ms
Streamr:eth-init Chainlink Oracle deployed at 0x163ED84743B84c2d9039c7972993D4eC82e0Bf06 +8s
Streamr:eth-init Chainlink Oracle token pointing to 0x326C977E6efc84E512bB9C30f76E30c160eD06FB +431ms
Streamr:eth-init Chainlink Oracle permission for 0x7b5F1610920d5BAf00D684929272213BaF962eFe is true +10s
Streamr:eth-init deploxing enscache from 0xdC353aA3d81fC3d67Eb49F443df258029B01D8aB +0ms
Streamr:eth-init ENSCache deployed at 0xEE2B6FBd2CB0806646e4220a5D1828B839C437eB +7s
Streamr:eth-init ENSCache owner is 0xdC353aA3d81fC3d67Eb49F443df258029B01D8aB +529ms
Streamr:eth-init Streamregistry deployed at 0xb341829f43EaF631C73D29dcd3C26637d1695e42 +18s
Streamr:eth-init setting Streamregistry address in ENSCache +0ms
Streamr:eth-init setting enscache address as trusted role in streamregistry +8s
Streamr:eth-init granting role 0x2de84d9fbdf6d06e2cc584295043dbd76046423b9f8bae9426d4fa5e7c03f4a7 ensaddress 0xEE2B6FBd2CB0806646e4220a5D1828B839C437eB +433ms
Streamr:eth-init granting role trusted role to deployer +8s
setting enscache address as trusted role in streamregistry
granting role 0x2de84d9fbdf6d06e2cc584295043dbd76046423b9f8bae9426d4fa5e7c03f4a7 ensaddress 0xEE2B6FBd2CB0806646e4220a5D1828B839C437eB
done granting role
Streamr:eth-init StreamStorageRegistry deployed at 0xCe97AF1A30C18aF9Eff60f9463b75bB8cCAE3777 +33s