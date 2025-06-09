# TODO could build these to "dist" directory so that we don't need to clean up the subgraph.yaml in package.json (the "rm subgraph.yaml" command)
# - then we can also remove subgraph.yaml from .gitignore
cp subgraph_dev2.yaml subgraph.yaml 
./scripts/copyAbisFromContractsPackage.sh
npx graph codegen
npx graph build