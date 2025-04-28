#!/bin/bash
set -ex

rm -rf contracts artifacts typechain
cp -r ../network-contracts/contracts .

hardhat compile

rm -rf dist
tsc
