# Subgraph definitions for streamr network

## Setup
Everything is already included in the streamr-docker-dev environment

The container and thus image that initially compiles and pushes the subgraph to the graph node
can be recreated with the Dockerfile.
To do so, run "docker build . -t streamr/deploy-network-subgraphs:dev", and then push the image
with "docker push streamr/deploy-network-subgraphs:dev"

## Prod deployment to the hosted service
First rename subgraph_prod.yaml to rename subgraph.yaml then follow the steps below (build it then set token, then deploy). The token can be found on the theGraph dashboard https://thegraph.com/hosted-service/dashboard?account=streamr-dev
Log in with your github user, then set the user to the streamr-dev user in the dashboard, not your github user!
```
cd packages/network-subgraphs
npm i
npm run build
npx graph auth --product hosted-service <TOKEN>
npm run deploy-production
```
## Setup locally without the streamr-docker-dev environment

first run a local eth blockchain (ganache, ganache-cli, harhat, ...) and deploy the contracts into that blockchain. You should also be abple to interact with the contract, for example with the REMIX IDE

then set up the graph infrastructure locally in docker (thegraph node, ipfs, postgres):
```
git clone https://github.com/graphprotocol/graph-node/
cd graph-node/docker
ONLY FOR LINUX: ./setup.sh
docker-compose up
```

then run the prepareTheGraph.js script in the scripts folder of the monorepo
when using the openzeppelin proxy contracts: take the abi of the logic contract (not the proxy) and the address of the proxy
also edit the githubname and subgraphname in the package.json taks

then run (in the folder of this file)

npm ci
npm run codegen
npm run build
npm run create-local
npm run deploy-local

(attention: create and deploy without '-local' will publish to the official The Graph API. And you can't ever delete a subgraph; )

You can test and build GraphQL queries at http://127.0.0.1:8000/subgraphs/name/streamr-dev/network-subgraphs/graphql

It's generally best to build the queries using the browser UI.

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
}
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
