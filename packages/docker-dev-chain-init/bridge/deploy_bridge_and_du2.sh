#!/bin/bash -eux
cd `dirname $0`

# we replace the default mediator with a mediator that calls transferAndCall()
# this is a temp fix and should be removed when tokenbridge supports callback
# pointer to the Tokenbridge contracts image:
CONTRACTS=streamr/tokenbridge-contracts
#CONTRACTS=poanetwork/tokenbridge-contracts

AMBRESULTS="bridgeDeploymentResultsAMB.json"
ERC677RESULTS="bridgeDeploymentResultsERC677.json"

echo "1. Deploying AMB"
TASK=amb
docker run --name $TASK --env-file amb.env $CONTRACTS deploy.sh
docker cp $TASK:/contracts/deploy/bridgeDeploymentResults.json $AMBRESULTS
docker rm $TASK

export HOME_AMB_BRIDGE=`jq -r .homeBridge.address < $AMBRESULTS`
export FOREIGN_AMB_BRIDGE=`jq -r .foreignBridge.address < $AMBRESULTS`

echo "2. Deploying ERC677 mediators over AMB"

echo "2.1 Single Token"
TASK=singleToken
ENV="-e HOME_AMB_BRIDGE=$HOME_AMB_BRIDGE -e FOREIGN_AMB_BRIDGE=$FOREIGN_AMB_BRIDGE"
docker run --name $TASK $ENV --env-file singleTokenMediator.env $CONTRACTS deploy.sh
docker cp $TASK:/contracts/deploy/bridgeDeploymentResults.json $ERC677RESULTS
docker rm $TASK

source singleTokenMediator.env
export ERC20_TOKEN_ADDRESS
export HOME_ERC677_MEDIATOR=`jq -r .homeBridge.homeBridgeMediator.address < $ERC677RESULTS`
export HOME_ERC677=`jq -r .homeBridge.bridgeableErc677.address < $ERC677RESULTS`
export FOREIGN_ERC677_MEDIATOR=`jq -r .foreignBridge.foreignBridgeMediator.address < $ERC677RESULTS`

echo "2.2 Multi Token"
CONTRACTS=poanetwork/omnibridge
TASK=omnibridge
ENV="-e HOME_AMB_BRIDGE=$HOME_AMB_BRIDGE -e FOREIGN_AMB_BRIDGE=$FOREIGN_AMB_BRIDGE"
docker run --name $TASK $ENV --env-file omnibridgeMediator.env $CONTRACTS deploy.sh
docker cp $TASK:/contracts/deploy/bridgeDeploymentResults.json $ERC677RESULTS
docker rm $TASK

echo "3. Deploying DataUnion and Factory Contracts"
node ../deploy_du2_factories.js
