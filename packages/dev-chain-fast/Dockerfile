FROM node:18-slim
WORKDIR /usr/src/hardhat
COPY ./ ./
RUN npm i
# RUN npm run build -w=network-contracts
# WORKDIR /usr/src/hardhat/packages/dev-chain-fast
# RUN npm run deploy
# CMD npx hardhat node
CMD ["/bin/bash", "/usr/src/hardhat/start.sh"]
# ENTRYPOINT [ "/bin/bash" ]


