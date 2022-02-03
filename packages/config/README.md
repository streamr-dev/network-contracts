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
import { Address, Chains, loadConfig } from "index"

const config: Chains = loadConfig("production")
const address: Address = config.ethereum.contracts["DATA-token"]
```

Other languages can read the [JSON file](./src/networks.json) directly.

## License
[MIT](LICENSE)
