FROM node:18-slim
RUN apt-get update && apt-get install -y \
	build-essential \
	curl \
	git \
	python-is-python3 \
	apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
	jq \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /
RUN node --version
RUN npm --version
COPY ./ ./
RUN npm run clean
RUN npm i
ENV DEBUG=*

# run `hardhat compile` (see dependencyCompiler in hardhat config for what's compiled) so that hardhat upgrades finds the artifacts
RUN npm run build -w=@streamr-contracts/docker-dev-chain-init

CMD npm run preload -w=@streamr-contracts/docker-dev-chain-init && \
	npm run deploy-du3 -w=@streamr-contracts/docker-dev-chain-init
