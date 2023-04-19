FROM node:18-slim

# RUN apk add libsecret-dev
# RUN apt update
# RUN apt install -y libsecret-1-dev
# RUN mkdir /firstrun && chown node:node /firstrun
RUN mkdir -p /home/node/app/script && chown -R node:node /home/node/app
WORKDIR /home/node/app/script

USER node

COPY --chown=node:node . .

RUN mv network-contracts ../

RUN npm i
ENV DEBUG=*
CMD [ "npm", "run", "start" ]
