FROM node:15-alpine

# RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package.json ./
# COPY yarn.lock ./

USER node

# RUN yarn --frozen-lockfile
RUN npm i

COPY --chown=node:node . .

CMD [ "node", "-r", "dotenv/config", "app.js" ]
