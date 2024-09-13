#!/bin/bash
set -ex

rm -rf artifacts
hardhat compile

sleep 1

rm -rf dist
tsc -p tsconfig.build.json
