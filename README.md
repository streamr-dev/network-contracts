This is a monorepo containing various smart contracts and subgraphs used by the Streamr Network, as well as potential other Ethereum-related bits and pieces that relate to the Network.

## Main packages

- [Network contracts](https://github.com/streamr-dev/network-contracts/tree/master/packages/network-contracts) The actual smart contracts used by the Streamr Network. Package exported from here has version 7.x.x and exports Typechain interfaces for Ethers v5.
- [Network contracts NPM package](https://github.com/streamr-dev/network-contracts/tree/master/packages/npm-network-contracts) ABI and Typechain interfaces for the Streamr Network smart contracts for Ethers v6, plus scripts for interacting with the smart contracts.
- [Network subgraphs](https://github.com/streamr-dev/network-contracts/tree/master/packages/network-subgraphs) The Graph subgraphs for many contracts in the `network-contracts` package
- [config](https://github.com/streamr-dev/network-contracts/tree/master/packages/config) Addresses of deployed Streamr contracts on various chains, importable as an npm package

## Other packages

- [chainlink-ens-external-adapter](https://github.com/streamr-dev/network-contracts/tree/master/packages/chainlink-ens-external-adapter) Custom Chainlink job that implements an ENS oracle used to verify ENS ownership on mainnet when creating streams
- [brubeck-migration-script](https://github.com/streamr-dev/network-contracts/tree/master/packages/brubeck-migration-script) Script that migrates opted-in streams from Corea to Brubeck network
