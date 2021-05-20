# Subgraph definitions for the stream permission registry

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

then you can paste graphQL queries at http://127.0.0.1:8000/subgraphs/name/<githubname>/<subgraphname>/graphql
or send queries to http://localhost:8000/subgraphs/name/<githubname>/<subgraphname>
for example with a gui like https://github.com/graphql/graphql-playground 
or from a webapplication

example queries:
```
{
   streams {
    id,
    metadata,
    permissions {
      id,
  		user,
  		edit,
      canDelete,
      publish,
      subscribed,
      share,
    }
  }
}
```

```

{
  permissions {
      id,
  		user,
  		isadmin,
  		publishRights
  		viewRights
  		expirationTime
    stream {
      id
    }
  }
}
```
