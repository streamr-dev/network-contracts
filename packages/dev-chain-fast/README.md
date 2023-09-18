
## Developing

Test the images manually before pushing to Docker Hub:
1. Build dev chain and subgraph deployer images
1. Start them, run tests (at least: run a subgraph query manually in the browser)
1. Push to Docker Hub

### Building the dev chain Docker images locally

1. Start Docker
1. Check that you don't have a container that uses the images `streamr/dev-chain-fast:dev` or `streamr/deploy-network-subgraphs:dev-fastchain`
    * if you do, delete the containers (or just delete all streamr-docker-dev related containers)
    * clear the volumes (delete all streamr-docker-dev related volumes)
1. `cd packages/dev-chain-fast && npm run docker:buildLocalArch`
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

### Push to Docker Hub

1. [Set up docker multi architecture builds with buildx](https://www.docker.com/blog/how-to-rapidly-build-multi-architecture-images-with-buildx/)
    * `docker buildx create --name mybuilder --use --bootstrap`
    * Check mybuilder is in `docker buildx ls`
1. Clean up
    * Stop and remove all containers: `streamr-docker-dev stop`
    * Remove images: `docker rmi streamr/dev-chain-fast:dev streamr/deploy-network-subgraphs:dev-fastchain`
    * Clear the volumes: `streamr-docker-dev wipe`
1. Build and push the images
    * `cd packages/dev-chain-fast && npm run buildMultiArchAndPush`
    * `cd packages/network-subgraphs && npm run docker:buildAndPushMultiArch`


### Addresses preloaded with DATA tokens
- address: 0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1 (private key: 0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0)
- address: 0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0 (private key: 0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb)
- address: 0xdC353aA3d81fC3d67Eb49F443df258029B01D8aB (private key: 0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae)
- address: 0x7986b71C27B6eAAB3120a984F26511B2dcfe3Fb4 (private key: 0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9)
- address: 0xa6743286b55F36AFA5F4e7e35B6a80039C452dBD (private key: 0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297)
- address: 0x7B556228B0D887CfC8d895cCe27CbC79d3e55b3C (private key: 0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728)
- address: 0x795063367EbFEB994445d810b94461274E4f109A (private key: 0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14)
- address: 0xcA9b39e7A7063cDb845483426D4f12F1f4A44A19 (private key: 0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7)
- address: 0x505D48552Ac17FfD0845FFA3783C2799fd4aaD78 (private key: 0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285)