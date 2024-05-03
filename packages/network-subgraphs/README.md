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

## Mainnet deployment to the Arbitrum / decentralized service (indexing Polygon MATIC)
1. Authenticate: Log into `https://thegraph.com/studio/subgraph/streamr/` using "Streamr subgraph owner" key from 1password. On the right hand side, look for "Auth & Deploy" and "Authenticate in CLI". Copy the command and run it in the terminal: `npx graph auth --studio DEPLOY_KEY`
1. `cp subgraph_matic.yaml subgraph.yaml`
1. `npm run build` (optional)
1. `npx graph deploy --studio streamr`
    * check version number from browser UI, bump it when asked
1. Follow progress and look at https://thegraph.com/studio/subgraph/streamr/logs for errors

## Testnet deployment to Studio (indexing Polygon Amoy)
1. Log into: `https://thegraph.com/studio/subgraph/streamr-amoy-testnet/`
1. `npx graph auth --studio <KEY>`
1. `cp subgraph_amoy.yaml subgraph.yaml`
1. `npm run build`
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

## Unit testing with [matchstick-as](https://thegraph.com/docs/en/developing/unit-testing-framework/#getting-started)

- build image:
`docker build -t matchstick -f Dockerfile.matchstick .`
- start container:
`docker run -it --rm --mount type=bind,source=<absolute-path-to-subgraph-folder>,target=/matchstick matchstick`
- run tests (using docker): `graph test -d`
