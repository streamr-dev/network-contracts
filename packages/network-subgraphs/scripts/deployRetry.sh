#!/bin/bash

# make sure LABEL is set
if [ -z "$LABEL" ]; then
    echo "Environment variable LABEL must be set to version to deploy, e.g. v0.0.15"
    exit 1
fi

# make sure SUBGRAPH is set
if [ -z "$SUBGRAPH" ]; then
    echo "Environment variable SUBGRAPH must be set to subgraph name, e.g. streamr-amoy-testnet"
    exit 1
fi

retries=0
while true; do
    echo "Attempting to deploy streamr-amoy-testnet..."
    npx graph deploy $SUBGRAPH -l $LABEL

    if [ $? -eq 0 ]; then
        echo "Deployment successful!"
        exit 0
    else
        retries=$((retries + 1))
        echo "Deployment has failed $retries times. Retrying in 10 minutes..."
        sleep 600
    fi
done
