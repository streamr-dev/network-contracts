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
Import DATA token production Ethereum address as a variable in a Javascript project:
```javascript
import { Chains, loadConfig } from "index"

const config: Chains = loadConfig("production")
const contractAddress: string = config.ethereum.contracts["DATA-token"]
const chainId: number = config.ethereum.id
const rpcHttpUrl: string = config.ethereum.rpcHttpUrl
const rpcWsUrl: string = config.ethereum.rpcWsUrl
```

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

Run build:
```bash
make clean build
```

Create a new release on Npmjs.com, update version in package.json, push a release commit, and tag it on GitHub:
```bash
./release.bash 0.0.1
```

## License
[MIT](LICENSE)
