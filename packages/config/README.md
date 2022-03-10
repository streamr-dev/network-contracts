# @streamr/config

## Features
- Streamr Network development and production smart contract addresses
- Zero dependency

## Installing
Using npm:
```bash
npm install --save @streamr/config
```

## Examples
### Typescript
Import DATA token production Ethereum address as a variable in a Typescript project:
```typescript
import * as config from "@streamr/config"

const chains: config.Chains = config.Chains.load("production")
const contractAddress: string = chains.ethereum.contracts["DATA-token"]
const chainId: number = chains.ethereum.id
const httpRpcEndpoints: RPCEndpoint[] = chains.ethereum.getRPCEndpointsByProtocol(config.RPCProtocol.HTTP)
const wsRpcEndpoints: RPCEndpoint[] = chains.ethereum.getRPCEndpointsByProtocol(config.RPCProtocol.WEBSOCKET)
```

You can also load configuration based on `$NODE_ENV` environment variable:
```typescript
import * as config from "config"

const chains: Chains = config.Chains.loadFromNodeEnv()
```

### Javascript
Use in a Javascript project:
```javascript
const config = require("@streamr/config")
const chains: config.Chains = config.Chains.loadFromNodeEnv()
```

### Other Languages
Other languages can read the [JSON file](./src/networks.json) directly.

## Development
### Common Setup
Git checkout repository and change directory to it.
Install [NVM](https://github.com/nvm-sh/nvm) and run command in the repository root:
```bash
nvm use
```

Install Node modules:
```bash
npm ci
```

Change directory:
```bash
cd packages/config
```

### Programming
Start with [Common Setup](#common-setup) before continuing.

Run tests:
```bash
make test
```

Run lint:
```bash
make lint
```

Run build:
```bash
make build
```

Run clean:
```bash
make clean
```

### Publish Release
Start with [Common Setup](#common-setup) before continuing.

Login to Npmjs.com:
```bash
npm login --registry https://registry.npmjs.org --scope @streamr
```

Run clean build, create a new release on Npmjs.com, update version in `package.json`, push a release commit, and tag it on GitHub:
```bash
./release.bash 0.0.1
```

## License
[MIT](LICENSE)
