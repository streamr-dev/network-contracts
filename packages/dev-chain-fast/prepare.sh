cd ../..
pwd
npm run build -w @streamr/network-contracts
npm run build -w @streamr/hub-contracts
cd packages/network-contracts
npm pack
cd ../hub-contracts
npm pack
cd ../dev-chain-fast
npm i --no-save ../network-contracts/streamr-network-contracts-*.tgz
npm i --no-save ../hub-contracts/streamr-hub-contracts-*.tgz