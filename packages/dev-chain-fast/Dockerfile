FROM node:18-slim
WORKDIR /usr/src/hardhat
COPY ./ ./
RUN npm i
RUN npm run deploy
CMD npx hardhat node
# ENTRYPOINT [ "/bin/sh" ]


