#!/bin/bash

retries=0
while true; do
    echo "Attempting to deploy streamr-amoy-testnet..."
    npx graph deploy streamr-amoy-testnet -l v1.0.4

    if [ $? -eq 0 ]; then
        echo "Deployment successful!"
        exit 0
    else
        retries=$((retries + 1))
        echo "Deployment has failed $retries times. Retrying in 10 minutes..."
        sleep 600
    fi
done
