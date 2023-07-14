#!/bin/bash -eux
cd `dirname $0`
LOG=smartContractInit.log

echo "Building smart-contracts-init docker image"
docker buildx build --platform linux/AMD64 -t streamr/smart-contracts-init:dev  -f ./packages/docker-dev-chain-init/Dockerfile .
#echo "Starting Streamr stack to fetch products from Engine and Editor"
# streamr-docker-dev start
#echo "Stopping OpenEthereum containers from Streamr stack"
# streamr-docker-dev stop parity-sidechain-node0 parity-node0
cd packages/docker-dev-chain-init
echo "Starting init stack with OpenEthereum"
docker-compose up -d parity-sidechain-node0
echo "waiting 5s for chains to start up"
sleep 5
docker-compose up -d smart-contracts-init
INITSTATUS=`docker wait streamr-dev-smart-contracts-init`

docker logs streamr-dev-smart-contracts-init &> $LOG

# remove timestamps in order to see in diffs if logs have changed
sed "s/^202[^ ]* //g" $LOG > tmp.log
cp tmp.log $LOG

echo "streamr-dev-smart-contracts-init finished with status $INITSTATUS. Logs in $LOG"
test $INITSTATUS -ne 0 && echo "streamr-dev-smart-contracts-init failed" && exit 1
docker exec streamr-dev-parity-sidechain-node0 /bin/bash -c 'mv /home/parity/parity_data /home/parity/parity_data.default'
#echo "Stopping Streamr stack"
#streamr-docker-dev stop
echo "Committing OpenEthereum images locally"
docker commit streamr-dev-parity-sidechain-node0 streamr/open-ethereum-poa-sidechain-preload1:dev
echo "Stopping all docker"
docker-compose stop
docker-compose rm -f
echo "Images created. To push to dockerhub: "
echo docker push streamr/open-ethereum-poa-sidechain-preload1:dev
