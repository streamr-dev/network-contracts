# Subgraph definitions for streamr network

Everything is already included in the streamr-docker-dev environment:
* Run `streamr-docker-dev start deploy-network-subgraphs`
* Test queries at http://127.0.0.1:8000/subgraphs/name/streamr-dev/network-subgraphs/graphql
* It's generally best to build the queries using the browser UI.

# Deployments

## Dev-docker deployment: Build & publish the image
The container and thus image that initially compiles and pushes the subgraph to the graph node
can be recreated with the Dockerfile. To do so:
- build image for local testing first: `docker:buildLocalArch`
- build & publish image: `docker:buildAndPushMultiArch`
- check the image was pushed: https://hub.docker.com/r/streamr/deploy-network-subgraphs/tags

Troubleshooting tips:
* `ERROR: Multiple platforms feature is currently not supported for docker driver.`
  * maybe for some reason buildx driver isn't selected/enabled
  * if `docker buildx ls` lists `mybuilder`, use that: `docker buildx use mybuilder` and try again

## Mainnet deployment to the Arbitrum / decentralized service (indexing Polygon MATIC)
1. Authenticate: Log into `https://thegraph.com/studio/subgraph/streamr/` using "Streamr subgraph owner" key from 1password. On the right hand side, look for "Auth & Deploy" and "Authenticate in CLI". Copy the command and run it in the terminal: `npx graph auth DEPLOY_KEY`
1. `./build.sh polygon`
1. `npx graph deploy streamr`
    * check version number from browser UI, bump it when asked
1. Follow progress and look at https://thegraph.com/studio/subgraph/streamr/logs for errors

## Testnet deployment to Studio (indexing Polygon Amoy)
1. Log into: `https://thegraph.com/studio/subgraph/streamr-amoy-testnet/`
1. `npx graph auth --studio <KEY>`
1. `./build.sh polygonAmoy`
1. `npx graph deploy --studio streamr-amoy-testnet`
1. Follow progress and look at https://thegraph.com/hosted-service/subgraph/streamr-dev/network?version=pending&selected=logs for errors
``

# Changelog

* v0.0.3
  * Sponsorhip.spotAPY and .projectedInsolvency changes (ETH-736)
* v0.0.4
  * Operator.contractVersion and .earliestUndelegationTimestamp (ETH-728)
  * StreamrConfig.minimumDelegationSeconds (ETH-717)
* v0.0.5
  * Added controllers to Operator entity (ETH-753)
  * BROKEN: controllers weren't actually added
* v0.0.6
  * Fixed controllers not getting added
  * Added Delegation.isSelfDelegation, zeroed earliestUndelegationTimestamp for self-delegations
* v0.0.7
  * Sponsorship APY fix (ETH-759)
* v0.0.8
  * Sponsorship initial sponsoring event fix (FRONT-1921)
  * Added StreamPermission.userId field, deprecated StreamPermission.userAddress (ETH-787)
* v0.0.9
  * StreamRegistryV5 (Arbitrary length user id, ETH-787) deployment to Polygon
* v0.0.10
  * Fixed log message
* v0.0.12
  * StreamPermission.id is now a hash of streamId and userId (ETH-867)
* v0.0.13
  * StreamPermission.id is now start of streamId + a hash of streamId and userId (ETH-875)
* v0.0.15
  * Streams with id over 1000 characters are now dropped from the subgraph. They still exist in the StreamRegistry but are not indexed. (ETH-876)
* v0.0.16
  * Added PastDelegationCount entity, add running count into Delegation.id
* v0.0.17
  * Added Stream#idAsString field (ETH-879)

# Developer notes

## Setup locally without the streamr-docker-dev environment

first run a local eth blockchain (ganache, ganache-cli, harhat, ...) and deploy the contracts into that blockchain. You should also be abple to interact with the contract, for example with the REMIX IDE

then set up the graph infrastructure locally in docker (thegraph node, ipfs, postgres):
```
git clone https://github.com/graphprotocol/graph-node/
cd graph-node/docker
ONLY FOR LINUX: ./setup.sh
docker-compose up
```

npm ci
npm run codegen
npm run build
npm run create-local
npm run deploy-local

Streams example query:
```
{
  streams {
    id
    metadata
    createdAt
    updatedAt
    permissions {
      id
    }
    storageNodes {
      id
    }
  }
}``
```

Projects example query:
```
{
  projects {
    id
    domainIds
    minimumSubscriptionSeconds
    metadata
    isDataUnion
    streams
    createdAt
    updatedAt
    score
    permissions {
      id
    }
    subscriptions {
      id
    }
    paymentDetails {
      id
    }
    purchases {
      id
    }
  }
}
```

Projects metadata full-text search:
```
{
  projectSearch(text: "metadata keyword") {
    id
  }
}
```
