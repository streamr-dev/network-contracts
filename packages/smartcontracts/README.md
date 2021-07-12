<h3>Deploy Streamregistry and connect the Graph</h3>

Just run
```
npm ci
npm run build
npm run localDeploy
```
to deploy the contracts into a locally running eth environment.
Then follow the README in the streamregistry-thegraph-subgraph folder.


<h3>Proxy contracts</h3>

The proxy enables upgradability of contract code without the need to change all addresses in software that talks to the contract and without the need to migrate data that is inside the old contract, that is being upgraded. Also the upgrade can only be controlled by a ProxyAdmin contract. To find out more visit
https://docs.openzeppelin.com/contracts/3.x/api/proxy  and
https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies

To deploy the contract with a proxy into a locally running eth environment run
```
npm run localDeployProxy
```
then copy the Proxy and Proxyadmin adresses to the upgradeProxy.ts script and run it with
```
npm run localUpgradeImpl
````

