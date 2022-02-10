# Smart Contract init
This repo is used to build the parity images streamr/open-ethereum-poa-mainchain-preload1 and streamr/open-ethereum-poa-sidechain-preload1, which are preloaded mainchain and sidechain images for use with streamr-docker.dev. The following are setup:
 * Marketplace
   * Also test products are loaded (see products.json)
 * Marketplace Uniswap Adapter
 * The token bridge (AMB) and mediator
 * the DU2 factories and templates.

## Dev docker pre-funded account keys

Parity Default Private Key
* `0x4d5db4107d237df6a3d58ee5f70ae63d73d7658d4026f2eefd2f204c81682cb7`

Private Keys:
* `0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0`
* `0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb`
* `0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae`
* `0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9`
* `0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297`
* `0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728`
* `0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14`
* `0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7`
* `0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285`
* `0x0000000000000000000000000000000000000000000000000000000000000nnn` where `nnn` = 000...3e7 (that's 1000 in decimal)

## Dev docker addresses

This script generates the following Ethereum addresses:

### Dev "mainnet" (localhost:8545):
* DATAcoin address: 0xbAA81A0179015bE47Ad439566374F2Bae098686F
* Marketplace2 address: 0xF1371c0f40528406dc4f4cAf89924eA9Da49E866
* OTHERcoin address: 0x642D2B84A32A9A92FEc78CeAA9488388b3704898
* UniswapAdaptor address: 0xE4eA76e830a659282368cA2e7E4d18C4AE52D8B3
* UniswapFactory address: 0xd2D23b73A67208a90CBfEE1381415329954f54E2
* Tracker NodeRegistry: 0xBFCF120a8fD17670536f1B27D9737B775b2FD4CF
* ENS: 0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03
* FIFSRegistrar for TLD (top level domain) 'eth': 0x57B81a9442805f88c4617B506206531e72d96290
* PublicResolver (reusable): 0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c
* Uniswap2 router: 0xeE1bC9a7BFF1fFD913f4c97B6177D47E804E1920
* Uniswap2Adapter: 0x0bADa0acE1d16ABf1ce1aAED9Bc7Ce231ECc35b5

Bridge related:
* foreign_amb: 0xaFA0dc5Ad21796C9106a36D68f69aAD69994BB64
* dedicated DATA foreign_erc_mediator: 0xedD2aa644a6843F2e5133Fe3d6BD3F4080d97D9F
* foreign omnibridge: 0x6346Ed242adE018Bd9320D5E3371c377BAB29c31
* foreign_erc20: 0xbAA81A0179015bE47Ad439566374F2Bae098686F

DataUnion related:
* foreign_du_factory: 0x4bbcBeFBEC587f6C4AF9AF9B48847caEa1Fe81dA


### Dev "xdai" (localhost:8546)
* Storage NodeRegistry: 0xbAA81A0179015bE47Ad439566374F2Bae098686F
* Uniswap2 router: 0xd2D23b73A67208a90CBfEE1381415329954f54E2
* BinanceAdapter: 0xdc5F6368cd31330adC259386e78604a5E29E9415
* StreamRegistry: 0xa86863053cECFD9f6f861e0Fd39a042238411b75
* Chainlink oracle: 0xD94D41F23F1D42C51Ab61685e5617BBC858e5871
* LINK token contract: 0x3387F44140ea19100232873a5aAf9E46608c791E
* ENScache: 0xD1d514082ED630687a5DCB85406130eD0745fA06
* Stream Storage Registry: 0xE4eA76e830a659282368cA2e7E4d18C4AE52D8B3

Bridge related:
* home_amb: 0xaFA0dc5Ad21796C9106a36D68f69aAD69994BB64
* home_erc677: 0x73Be21733CC5D08e1a14Ea9a399fb27DB3BEf8fF
* dedicated DATA home_erc_mediator: 0xedD2aa644a6843F2e5133Fe3d6BD3F4080d97D9F
* home omnibridge: 0x41B89Db86BE735c03A9296437E39F5FDAdC4c678

DataUnion related:
* home_du_factory: 0x4A4c4759eb3b7ABee079f832850cD3D0dC48D927


## Running

smart-contracts-init container is no longer part of streamr-docker-dev. Instead we use the docker-compose.yml file here to build the preloaded parity images

Dependencies:
Build and tag required docker images.
 1. git clone https://github.com/poanetwork/omnibridge.git; cd omnibridge; docker build . -t 'poanetwork/omnibridge'
 2. git clone https://github.com/streamr-dev/tokenbridge-contracts.git; cd tokenbridge-contracts; docker build . -t 'streamr/tokenbridge-contracts'

To build images:
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
