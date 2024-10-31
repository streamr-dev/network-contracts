#!/bin/bash
set -ex

rm -rf artifacts
npm run compile

rm -rf dist
tsc -p tsconfig.build.json

# this requires a running Docker daemon
if docker ps > /dev/null 2>&1; then
  ./generateSelectorsTxt.sh
else
  echo "Docker is not running, skipping generateSelectorsTxt.sh"
fi
