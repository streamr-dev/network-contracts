#!/bin/bash

rm -rf artifacts
hardhat compile

rm -rf dist
tsc -p tsconfig.build.json

# this requires a running Docker daemon
./generateSelectorsTxt.sh
