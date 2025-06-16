#!/bin/bash
set -ex

rm -rf artifacts
npm run compile

rm -rf dist
npx tsc -p tsconfig.build.json

npx ts-node generateSelectors.ts > selectors.txt
