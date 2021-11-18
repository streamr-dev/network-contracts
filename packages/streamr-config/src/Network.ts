import { Address } from "./Address"
import { Environment } from "./Environment"

export class Network {
  constructor(readonly chainId: number,
        readonly environment: Environment,
        readonly contracts: Map<string, Address>) {
    if (chainId < 0) {
      throw new Error(`ChainId must be a positive integer.`)
    }
  }
}
