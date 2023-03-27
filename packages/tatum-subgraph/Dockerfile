FROM node:16-buster

# RUN apk add libsecret-dev
RUN apt update
RUN apt install -y libsecret-1-dev
RUN mkdir /firstrun && chown node:node /firstrun
RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

USER node

COPY --chown=node:node ./../. .

RUN npm i
RUN npm run build -w=@streamr-contracts/network-contracts
WORKDIR /home/node/app/packages/tatum-subgraph/
RUN chmod +x start.sh
ENTRYPOINT [ "sh", "./start.sh" ]
