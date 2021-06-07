FROM node:16-buster

RUN mkdir -p /home/node/app && chown -R node:node /home/node/app
WORKDIR /home/node/app
COPY package.json ./
USER node

RUN npm i
COPY --chown=node:node . .
HEALTHCHECK --interval=10s --timeout=10s --start-period=5s --retries=60 CMD curl -sS http://localhost:8080/health

ENTRYPOINT [ "node", "-r", "dotenv/config", "app.js" ]
