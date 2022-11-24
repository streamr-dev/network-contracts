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
