import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"
import "hardhat-dependency-compiler"

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.8.13",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
            {
                version: "0.8.9",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
        ],
    },
    typechain: {
        outDir: "./typechain",
        target: "ethers-v6",
    },
    dependencyCompiler: {
        paths: [
            "@openzeppelin/contracts/metatx/MinimalForwarder.sol",
            "@opengsn/contracts/src/forwarder/Forwarder.sol",
            "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol",
            "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol",
            "@openzeppelin/contracts-upgradeable/metatx/MinimalForwarderUpgradeable.sol",
            "@openzeppelin/contracts/interfaces/IERC1271.sol",
            "@ensdomains/ens-contracts/contracts/registry/ENS.sol",
            "@ensdomains/ens-contracts/contracts/registry/FIFSRegistrar.sol",
            "@ensdomains/ens-contracts/contracts/resolvers/Resolver.sol",
            "@ensdomains/ens-contracts/contracts/registry/ENSRegistry.sol", // exported in exports.ts
        ],
    },
}

export default config
