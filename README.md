This is a monorepo containing various smart contracts and subgraphs used by the Streamr Network, as well as potential other Ethereum-related bits and pieces that relate to the Network.

## Main packages

- [Network contracts](https://github.com/streamr-dev/network-contracts/tree/main/packages/network-contracts) The actual smart contracts used by the Streamr Network. Package exported from here has version 7.x.x and exports Typechain interfaces for Ethers v5.
- [Network contracts NPM package](https://github.com/streamr-dev/network-contracts/tree/main/packages/npm-network-contracts) ABI and Typechain interfaces for the Streamr Network smart contracts for Ethers v6, plus scripts for interacting with the smart contracts.
- [Network subgraphs](https://github.com/streamr-dev/network-contracts/tree/main/packages/network-subgraphs) The Graph subgraphs for many contracts in the `network-contracts` package
- [config](https://github.com/streamr-dev/network-contracts/tree/main/packages/config) Addresses of deployed Streamr contracts on various chains, importable as an npm package