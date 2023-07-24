#!/bin/bash -eux
cd `dirname $0`

cd packages/docker-dev-chain-init
echo "Starting init stack with OpenEthereum"
docker-compose up -d parity-sidechain-node0
echo "waiting 5s for chains to start up"
sleep 5

export DEBUG=*
npx hardhat run --network localsidechain index.js 2>&1 |tee log.txt
echo "Snapshotting chain state"
docker exec streamr-dev-parity-sidechain-node0 /bin/bash -c 'mv /home/parity/parity_data /home/parity/parity_data.default'
echo "Committing OpenEthereum images locally"
docker commit streamr-dev-parity-sidechain-node0 streamr/open-ethereum-poa-sidechain-preload1:dev
echo "Stopping all docker"
docker-compose stop
docker-compose rm -f
echo "Images created. To push to dockerhub: "
echo docker push streamr/open-ethereum-poa-sidechain-preload1:dev
