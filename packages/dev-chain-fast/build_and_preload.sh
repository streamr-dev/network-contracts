#!/bin/bash -eux
LOG=contracDeployment.log
echo "Creating empty fast-chain docker image"
docker build -t streamr/dev-chain-fast .
echo "Deploying contracts"

docker run streamr/dev-chain-fast -p 8545:8545
docker logs streamr/dev-chain-fast &> $LOG

npm run deploy

echo "deployment finished, logs in $LOG"
echo "Committing deployment to image"

docker commit streamr-dev-parity-sidechain-node0 streamr/open-ethereum-poa-sidechain-preload1:dev
echo "Images created. To push to dockerhub: "
echo docker push streamr/dev-chain-fast
