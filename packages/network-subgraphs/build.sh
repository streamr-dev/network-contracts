#!/bin/bash

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <environment-id>"
    exit 1
fi

# TODO could build these to "dist" directory so that we don't need to clean up the subgraph.yaml in package.json (the "rm subgraph.yaml" command)
# - then we can also remove subgraph.yaml from .gitignore
cp subgraph_$1.yaml subgraph.yaml 
./scripts/copyAbisFromContractsPackage.sh
npx graph codegen
npx graph build