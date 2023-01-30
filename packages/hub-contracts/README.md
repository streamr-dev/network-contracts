# Streamr Hub

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

### Interact cross-chain on Marketplace
Export the following to dev env:
- origin chain where the RemoteMarketplace is deployed (e.g. `export ORIGIN_DOMAIN=gnosis`)
- destination chain where the ProjectRegistry & MarketplaceV4 is deployed (e.g. `export DESTINATION_DOMAIN=polygon`)
- buyer private key (e.g. `export KEY=0x1234...`)

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

## ProjectRegistry

### Deloyed on:
- polygon at `0x496a6154da5aA6a021a3bd0DCd337DA80F48a6e1`.

## ProjectStakingV1

Simple staking and unstaking functionality related to projects. It allows users to deposit tokens to the contract and specify a `projectId` which they're staking the tokens for. The contract keeps track of who has staked how many tokens against what projects.
The contract supports ERC-677 so that when tokens are `transferAndCall`ed to the contract, they are added to the staked amount for that user. The contract is deployed with an upgradable proxy.

The following two alternatives will lead to the same end result:
- `approve`, then `stake` (ERC-20) 
- `transferAndCall` (ERC-677)

### Interface:
- `stake(projectId, amount)`
    - Checks that `projectId` is a valid project in the `ProjectRegistry` identified by `projectRegistryAddress`
    - Transfers amount of tokens (identified by `tokenAddress`) from the caller into the contract and updates the internal bookkeeping to mark them as staked against `projectId` and owned by the caller
    - Fires a `Stake(projectId, user, amount)` event
- `unstake(projectId, amount)`, the opposite of stake
    - Fails if amount is larger than what the user has deposited on the project via stake
    - Transfers amount of tokens from the contract to the caller and updates internal bookkeeping
    - Fires a `Unstake(projectId, user, amount)` event
- `transferAndCall(contractAddress, amount, projectIdBytes)` - Same as approve + stake, but in one tx
- `getProjectStake(projectId)`- `view` function that returns the total amount staked on a given `projectId` across all users
- `getUserStake(userAddress)`- `view` function that returns the total amount that address `userAddress` has staked in the contract across all projects
- `getTotalStake()` - `view` function that returns the total amount of tokens staked across all users and projects

### Subgraph:
- The existing subgraph for Projects is aware of this contract and watch for `Stake` and `Unstake` events. It maintains a new `score` field on `Project` objects which maintains the total amount staked on that project so that Stake and Unstake events increment/decrement the score field
- The field is called score instead of stake because in the future there may be other inputs in addition to the stake, i.e. it may not always be 1:1 with the stake

### Deloyed on:
- polygon at `0xAA7a4BdBE91F143F3103206e48A8AfF21101B6DE`. The staking token address is the DATA token `0x496a6154da5aA6a021a3bd0DCd337DA80F48a6e1`
