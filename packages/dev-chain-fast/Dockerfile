FROM node:25-slim
RUN apt-get update && apt-get install curl -y
WORKDIR /usr/src/hardhat
COPY ./dist ./package.json ./*.tgz ./hardhat.config.js ./start.sh ./
RUN npm i --omit=dev ./streamr-network-contracts-*.tgz

CMD ["/bin/bash", "/usr/src/hardhat/start.sh"]
# ENTRYPOINT [ "/bin/bash" ]


