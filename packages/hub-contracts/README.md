# Streamr Marketplace

## Development notes

### Upgrading the smart contract

The Marketplace smart contract is UUPS upgradeable proxy contract. When you need to upgrade it, please follow this process:
* make a copy of the `contracts/Marketplace.sol` that you want to upgrade to. Name it `MarketplaceV3.sol` (or version number one greater than the previous)
* also change the contract name in the file
* deploy the new contract
* call `upgrade` on the proxy contract with the new contract's address

As a result, the contracts directory will contain:
* `MarketplaceV*.sol` files that are the deployed contracts
* `Marketplace.sol` that is the work-in-progress, not deployed

### Interacting with the deployed contract(s)

`npm run interact` will talk to the contracts in [the dev-docker environment](https://github.com/streamr-dev/streamr-docker-dev/). To run in other environments, e.g. gnosis, set the following environment variables:
```sh
export CHAIN=gnosis
export POLYGON=polygon
export ADMIN=0x...
export BUYER=0x...
export STREAMR_API_URL=https://streamr.network/api/v2
npm run interact
```

### Deploy/Interact w contracts

Prerequisites:
- export DESTINATION_CHAIN=chainName - the chain where cross-chain messages are sent to (e.g. ProjectRegistry, MarketplaceV4)
- export ORIGIN_CHAIN=chainName - the chain where cross-chain messages are sent from (e.g. RemoteMarketplace)
- export KEY=privateKey

### Interact cross-chain on Marketplace
Export the following to dev env:
- destination origin where the RemoteMarketplace is deployed (e.g. `export DESTINATION_DOMAIN=mumbai`)
- destination domain where the MarketplaceV4 is deployed (e.g. `export DESTINATION_DOMAIN=goerli`)
- buyer private key (e.g. `export DESTINATION_DOMAIN=0x1234...`)
- app key from a node provider (e.g. https://rpc.maticvigil.com => `export MUMBAI_KEY=01234`)

### Deployed on live testnet (from Celo to Optimism):

Contracts:
- ProjectRegistry deployed on alfajores at: `0x66041bd9062887251ad66e16D9F79140440B6E9f`
- MarketplaceV4 deployed on alfajores at: `0x3B687FcCA96b9931E1fb91CF644c634e0bad1D8c`
- RemoteMarketplace deployed on optimistic-goerli at: `0x3179C38822015797bab2a4C8C79688DC15d3A587`

Purchases made on the remote marketplace require 2 actions and 2 transactions for each action:
- [query](https://explorer.hyperlane.xyz/message/231084) data from origin to destination chain
    - [opt-goerli tx](https://goerli-optimism.etherscan.io/tx/0xb80c2dbe18466bd15d13f1e203ea50a8e204de13d9e240ff35fcf68837dbf88a)
    - [alphajores tx](https://alfajores.celoscan.io/tx/0xe60078d45bf3dc8a882e76ae1b051f28083e7505b2e90d75a6974519d90a18de)
- [dispatch](https://explorer.hyperlane.xyz/message/231085) message from origin to destination chain:
    - [alphajores tx](https://alfajores.celoscan.io/tx/0xe60078d45bf3dc8a882e76ae1b051f28083e7505b2e90d75a6974519d90a18de)
    - [opt-goerli tx](https://goerli-optimism.etherscan.io/tx/0x46cbd03b586cb060fbd729c21039a9805fd9c6ea8d0ef22b1c6e8f11af8d684a)
These examples use older contracts:
- ProjectRegistry deployed on alfajores at: `0x32A142A27A595DC75aD1443728fecCbD5650446A`
- MarketplaceV4 deployed on alfajores at: `0x14577e0D5BD77536E073712d98E471edDaFAE8b4`
- RemoteMarketplace deployed on optimistic-goerli at: `0xBef916b1EC6EAA3F522368f75094DAed5c228aF6`
