#!/bin/bash -eux
cd `dirname $0`
LOG=smartContractInit.log

function checkImg {
if [ ! `docker images -q $1` ]
then
  echo "Missing required docker image $1."
  exit 1
fi
}

checkImg poanetwork/omnibridge
checkImg streamr/tokenbridge-contracts

echo "Building smart-contracts-init docker image"
docker build -t streamr/smart-contracts-init:dev .
#echo "Starting Streamr stack to fetch products from Engine and Editor"
# streamr-docker-dev start
#echo "Stopping OpenEthereum containers from Streamr stack"
# streamr-docker-dev stop parity-sidechain-node0 parity-node0
echo "Starting init stack with OpenEthereum"
docker-compose up -d parity-node0 parity-sidechain-node0
echo "waiting 5s for chains to start up"
sleep 5
docker-compose up -d smart-contracts-init
INITSTATUS=`docker wait streamr-dev-smart-contracts-init`
docker logs streamr-dev-smart-contracts-init &> $LOG
echo "streamr-dev-smart-contracts-init finished with status $INITSTATUS. Logs in $LOG"
test $INITSTATUS -ne 0 && echo "streamr-dev-smart-contracts-init failed" && exit 1
docker exec streamr-dev-parity-sidechain-node0 /bin/bash -c 'mv /home/parity/parity_data /home/parity/parity_data.default'
docker exec streamr-dev-parity-node0 /bin/bash -c 'mv /home/parity/parity_data /home/parity/parity_data.default'
#echo "Stopping Streamr stack"
#streamr-docker-dev stop
echo "Committing OpenEthereum images locally"
docker commit streamr-dev-parity-sidechain-node0 streamr/open-ethereum-poa-sidechain-preload1:dev
docker commit streamr-dev-parity-node0 streamr/open-ethereum-poa-mainchain-preload1:dev
echo "Stopping all docker"
docker-compose stop
docker-compose rm -f
echo "Images created. To push to dockerhub: "
echo docker push streamr/open-ethereum-poa-sidechain-preload1:dev
echo docker push streamr/open-ethereum-poa-mainchain-preload1:dev
