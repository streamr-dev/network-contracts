#!/bin/bash
set -ex

rm -rf artifacts
npm run compile

rm -rf dist
tsc -p tsconfig.build.json

npx ts-node generateSelectors.ts > selectors.txt
