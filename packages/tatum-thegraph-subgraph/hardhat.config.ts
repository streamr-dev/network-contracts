import { HardhatUserConfig } from 'hardhat/types'
require('hardhat-dependency-compiler')

declare module 'hardhat/types/config' {
    interface HardhatUserConfig {
      dependencyCompiler?: any;
    }
}

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
            url: 'http://10.200.10.1:8546',
            accounts: ['0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0']
        },
    },
    dependencyCompiler: {
        paths: [
            'smartcontracts/contracts/BrokerEconomics/Bounties/Bounty.sol',
            'smartcontracts/contracts/BrokerEconomics/Bounties/BountyFactory.sol',
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
            }],
    },
}
export default config
