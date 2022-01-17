FROM node:14
RUN apt-get update && apt-get install -y \
	build-essential \
	curl \
	git \
	python \
	apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
	jq \
	&& rm -rf /var/lib/apt/lists/*
# the bridge script needs docker
# following lines are the official way to install docker on debian
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
RUN echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
RUN apt-get update
RUN apt-get install -y docker-ce docker-ce-cli containerd.io

WORKDIR /
RUN node --version
RUN npm --version
COPY ./ ./
RUN npm ci --only=production
ENV DEBUG=*
CMD node index.js && ./bridge/deploy_bridge_and_du2.sh

