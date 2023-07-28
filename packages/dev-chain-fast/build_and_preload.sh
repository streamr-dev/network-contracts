#!/bin/bash -eux

echo "Creating empty fast-chain docker image"
build -t streamr/dev-chain-fast .
echo "Deploying contracts"

docker run streamr/dev-chain-fast
docker logs streamr/dev-chain-fast &> contracDeployment.log


# remove timestamps in order to see in diffs if logs have changed
sed "s/^202[^ ]* //g" $LOG > tmp.log
cp tmp.log $LOG

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
