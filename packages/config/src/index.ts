import { Environment } from "./Environment"
import networksAsJSON from "./networks.json"

export interface Address {
  toString(): string
}

export interface Contracts {
  [name: string]: Address
}

export interface Chain {
  id: number
  contracts: Contracts
}

export interface Chains {
  [name: string]: Chain
}

export type Networks = {
  [env in Environment]: Chains
}

export const loadConfig = (env: Environment): Chains => {
  const networks: Networks = networksAsJSON
  const chain: Chains = networks[env]
  return chain
}
