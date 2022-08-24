This is a monorepo containing various smart contracts and subgraphs used by the Streamr Network, as well as potential other Ethereum-related bits and pieces that relate to the Network.

## Main packages

- [smartcontracts](https://github.com/streamr-dev/network-contracts/tree/master/packages/smartcontracts) The actual smart contracts used by the Streamr Network
- [streamregistry-thegraph-subgraph](https://github.com/streamr-dev/network-contracts/tree/master/packages/streamregistry-thegraph-subgraph) The Graph subgraphs for many contracts in the `smartcontracts` package
- [config](https://github.com/streamr-dev/network-contracts/tree/master/packages/config) Addresses of deployed Streamr contracts on various chains, importable as an npm package

## Other packages

- [chainlink-ens-external-adapter](https://github.com/streamr-dev/network-contracts/tree/master/packages/chainlink-ens-external-adapter) Custom Chainlink job that implements an ENS oracle used to verify ENS ownership on mainnet when creating streams
- [docker-dev-chain-init](https://github.com/streamr-dev/network-contracts/tree/master/packages/docker-dev-chain-init) Tooling for building the docker images for local dev chains
- [brubeck-migration-script](https://github.com/streamr-dev/network-contracts/tree/master/packages/brubeck-migration-script) Script that migrates opted-in streams from Corea to Brubeck network
