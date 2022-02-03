import networksAsJSON from "./networks.json"

export interface Contracts {
  [name: string]: string
}

export interface Chain {
  id: number
  rpcHttpUrl: string
  rpcWsUrl: string
  contracts: Contracts
}

export interface Chains {
  [name: string]: Chain
}

export type Environment = "development" | "production"

export type Networks = {
  [env in Environment]: Chains
}

export const loadConfig = (env: Environment): Chains => {
  const networks: Networks = networksAsJSON
  const chain: Chains = networks[env]
  return chain
}
