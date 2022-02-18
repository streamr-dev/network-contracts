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

export const loadConfigFromNodeEnv = (): Chains => {
    const nodeEnv = process.env.NODE_ENV
    if (nodeEnv === undefined) {
        throw new Error("NODE_ENV environment variable is not set")
    }
    if (nodeEnv !== "production" && nodeEnv !== "development") {
        throw new Error("NODE_ENV environment variable value must be either 'production' or 'development'")
    }
    const env: Environment = nodeEnv
    return loadConfig(env)
}