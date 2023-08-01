npm run clean
cd ../..
npm run build -w @streamr/network-contracts
npm run build -w @streamr/hub-contracts
cd packages/network-contracts
npm pack
cd ../hub-contracts
npm pack
cd ../dev-chain-fast
npm i ../network-contracts/streamr-network-contracts-*.tgz
npm i ../hub-contracts/streamr-hub-contracts-*.tgz