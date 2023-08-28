
## Developing

Test the images manually before pushing to Docker Hub:
1. Build dev chain and subgraph deployer images
2. Start them

### Building the dev chain Docker images locally

1. Start Docker
1. Check that you don't have a container that uses the images `streamr/dev-chain-fast:dev` or `streamr/deploy-network-subgraphs:dev-fastchain`
    * if you do, delete the containers (or just delete all streamr-docker-dev related containers)
    * clear the volumes (delete all streamr-docker-dev related volumes)
1. `cd packages/dev-chain-fast && npm run build`
    * this will build the contracts, pack them, and unpack in this directory for Dockerizing; then build the Docker image
1. `cd packages/network-subgraphs && npm run docker:buildLocalArch`

You should now see the two images freshly built: `docker images |head -n 3`

### Testing the Docker images manually

1. `streamr-docker-dev start deploy-network-subgraphs-fastchain`
1. Look for errors in logs:
    * `streamr-docker-dev log -f deploy-network-subgraphs-fastchain`
    * After it finishes: `streamr-docker-dev log graph-node-fastchain | grep ERR`
    * Test query at http://localhost:8800/subgraphs/name/streamr-dev/network-subgraphs/graphql
```
query {
  operators { id }
  sponsorships { id }
}
```
