# Smart Contract init
This repo is used to build the parity images streamr/open-ethereum-poa-mainchain-preload1 and streamr/open-ethereum-poa-sidechain-preload1, which are preloaded mainchain and sidechain images for use with streamr-docker.dev. The following are setup:
 * Marketplace
   * Also test products are loaded (see products.json)
 * Marketplace Uniswap Adapter
 * The token bridge (AMB) and mediator
 * the DU3 factories and templates.

## Dev docker pre-funded account keys

Parity Default Private Key
* `0x4d5db4107d237df6a3d58ee5f70ae63d73d7658d4026f2eefd2f204c81682cb7` // ???

Private Keys:
* `0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0` // deployer of contracts in docker env
* `0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb`
* `0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae`
* `0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9`
* `0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297`
* `0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728`
* `0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14` // DU DAO beneficiary
* `0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7`
* `0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285`
* `0x0000000000000000000000000000000000000000000000000000000000000nnn` where `nnn` = 000...3e7 (that's 1000 in decimal)

## Smart Contract addresses

Please refer to the [config package](https://github.com/streamr-dev/network-contracts/tree/master/packages/config) to find out the addresses of smart contracts deployed to the local dev chains.

## Running

smart-contracts-init container is no longer part of streamr-docker-dev. Instead we use the docker-compose.yml file here to build the preloaded parity images

Dependencies:
Build and tag required docker images.
 1. git clone https://github.com/poanetwork/omnibridge.git; cd omnibridge; docker build . -t 'poanetwork/omnibridge'
 2. git clone https://github.com/streamr-dev/tokenbridge-contracts.git; cd tokenbridge-contracts; docker build . -t 'streamr/tokenbridge-contracts'

To build images:

From the root of the monorepo:
./preload_parity_images.sh

This will tag the images locally and echo the command to push to dockerhub.
Note that you MUST remove the parity docker volumes to delete old chain data from docker and then restart `streamr-docker-dev` to see preload changes.

Tokenbridge:
The bridge dir contains code related to the setup of tokenbridge between the mainchain and sidechain images. bridge/tokenbridge-contracts contains some custom modifications Streamr has made to tokenbridge contracts. When tokenbridge implements transferAndCall for bridge tokens, this should be REPLACED with the tokenbridge image.

Chainlink node and thegraph node:
Steps needed to recreate the chainlink ecosystem from scratch. This should only be needed if it breaks, for example if the addresses for the linktoken and oracle contract change in the sidechain.
1. first run the smart contracts init to get the new addresses from the smartContractInit.log (don't forget to delete the named unused docker volumes after!) Also delete the chainlinkdata.sql from the postgres_init_scripts folder in the streamr-docker-dev repo
2. add the new LINKtoken contract address to the .env_streamr_sidechain file in chainlink_config in your local streamr-docker-dev repo
3. start the chainlink node and graph node with all their dependant containers by running streamr-docker-dev start chainlink graph-node. As soon as the chainlink gui is accessable (4.) pause the sidechain container so chainlinks view of the chain does not advance too much. When interacting with the chainlink gui, unpause and pause the sidechain if necessary.
4. log into the chainlink gui (url: localhost:6688, user:a@a.com, pass: testpass)
5. add a bridge, name:ensbridge, url:http://streamr-dev-chainlink-adapter:8080
6. add a job with the following job definition, but replace the address with the oracle contract address from the smartContractInit.log (klick create, then unpause the chain a bit, repause it):
{
  "name": "ResolveENSname",
  "initiators": [
    {
      "type": "runlog",
      "params": {
        "address": "0xE4eA76e830a659282368cA2e7E4d18C4AE52D8B3"
      }
    }
  ],
  "tasks": [
    {
      "type": "ensbridge"
    },
    {
      "type": "ethint256"
    },
    {
      "type": "ethtx"
    }
  ]
}
7. copy the jobid of the newly generated job to the index.js file here (line 73) and copy the node address from the Keys tab in the GUI also to the index.js file (line 72)
8. in the network-contracts repo add the streamregistry contract address to the subgraph.yaml file in the streamregistry-thegraph-subgraph workspace and run the doAll npm job
9. go into the postgres cointainer and run the following command to export all the chainlink and theGraph data 'pg_dump -U streamr streamr > chainlinkdata.sql'. Then copy the file outside the container into the postgres_init_scripts folder in the smart-contracts-init repo.
10. run the preload_parity_images.sh script again and also delete the volumes after.
11. upload the newly preloaded parity images
