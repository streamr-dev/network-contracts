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

## License
[MIT](LICENSE)
