## This package directory is for smart contracts development.

## The npm package published here should have version number 7.x.x, and it will export Typechain interfaces for Ethers v5. For later versions that use Ethers v6, look into the [npm-network-contracts](../npm-network-contracts) package.

# Streamr Network contracts

Solidity files plus Typescript interfaces for the Streamr Network smart contracts.

## Contracts

Listed by file path:
* [StreamRegistry](./contracts/StreamRegistry/StreamRegistryV5.sol): Streams are added here along with metadata how to join them
* [NodeRegistry](./contracts/NodeRegistry/NodeRegistry.sol): Storage nodes can register themselves here
* [StreamStorageRegistry](./contracts/StreamStorageRegistry/StreamStorageRegistryV2.sol): Connects storage nodes to streams that they store
* OperatorTokenomics: [Operator](./contracts/OperatorTokenomics/Operator.sol) and [Sponsorship](./contracts/OperatorTokenomics/Sponsorship.sol) contracts that govern how to pay for better service in the Network, and how to get paid for providing it
  * Spoiler: you '''sponsor''' streams by deploying a Sponsorship and sending DATA tokens to it, and operators '''stake''' into that Sponsorship to receive that DATA over time
  * if operators stake but don't actually provide service, they get kicked out and their stake gets slashed
  * additionally, 3rd parties can '''delegate''' their DATA tokens to the Operator contracts and receive a share of the operator's earnings. This way the operator gets more DATA to stake to more Sponsorships, in order to more fully utilize their network resources to earn more DATA.

## Usage from Typescript

Snippet from the [Operator client]():

```typescript
import { operatorABI, sponsorshipABI } from "@streamr/network-contracts"
import type { Operator, Sponsorship } from "@streamr/network-contracts"

...

const contract = new Contract(operatorContractAddress, operatorABI, this.provider) as unknown as Operator
contract.on("Staked", async (sponsorship: string) => {
    log(`got Staked event ${sponsorship}`)
})
```

The functions that end with `ForUserId` take an arbitrary `bytes` argument for the user ID. Addresses can also be given to these functions but they need to be padded to 32 bytes first, e.g.: `ethers.utils.hexZeroPad("0x1234567890123456789012345678901234567890", 32)` => `0x0000000000000000000000001234567890123456789012345678901234567890`.

## Developer notes

The package exports all of the artifacts needed to interact with the contracts, and also a class that deploys them into a chain and then gives an object with all addresses and with all contract objects.

An example of how to use it can be seen in network-contracts/packages/network-contracts/scripts/tatum/streamrEnvDeployer.ts, that can be run with the streamrEnvDeployer npm task


### Proxy contracts

The proxy enables upgradability of contract code without the need to change all addresses in software that talks to the contract and without the need to migrate data that is inside the old contract, that is being upgraded. Also the upgrade can only be controlled by a ProxyAdmin contract. To find out more visit
https://docs.openzeppelin.com/contracts/3.x/api/proxy  and
https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies

To deploy the contract with a proxy into a locally running eth environment run
```
npm run localDeployProxy
```
then copy the Proxy and Proxyadmin addresses to the upgradeProxy.ts script and run it with
```
npm run localUpgradeImpl
```

# Changelog

StreamRegistryV5: added functions for arbitrary bytes user IDs (they can only publish and subscribe, not grant/edit/delete)
7.0.8 export ENS type
4.2.0 export ERC677 ABI and type


## Publish package

- `npm version [major/minor]`
- `npm run clean`
- `npm run build`
- `npm publish --dry-run`
- `npm publish`
- `git add .`
- `git commit -m"release(network-contracts): vx.x.x"`
- `git tag network-contracts/vx.x.x`
- `git push`
- `git push --tags`
