import networksAsJSON from "./networks.json"

export interface Contracts {
  [name: string]: string
}

export enum RpcProtocol {
  HTTP,
  WEBSOCKET
}

export interface RpcEndpoint {
  url: string
  //readTimeoutSecond: int
  //writeTimeoutSecond: int
}

export interface Chain {
  id: number
  rpcEndpoints: RpcEndpoint[]
  contracts: Contracts
}

export interface Chains {
  [name: string]: Chain
}

export type Environment = "development" | "production"

export type Networks = {
  [env in Environment]: Chains
}

export const getRpcEndpointsByProtocol = (rpcEndpoints: RpcEndpoint[], protocol: RpcProtocol): RpcEndpoint[] => {
    const endpoints = new Array<RpcEndpoint>()
    for (const rpcEndpoint of rpcEndpoints) {
        if (protocol === RpcProtocol.HTTP) {
            if (rpcEndpoint.url.startsWith("https://") || rpcEndpoint.url.startsWith("http://")) {
                endpoints.push(rpcEndpoint)
            }
        } else if (protocol === RpcProtocol.WEBSOCKET) {
            if (rpcEndpoint.url.startsWith("wss://") || rpcEndpoint.url.startsWith("ws://")) {
                endpoints.push(rpcEndpoint)
            }
        }
    }
    return endpoints
}

export const loadConfig = (env: Environment): Chains => {
    const networks: Networks = networksAsJSON
    const chain: Chains = networks[env]
    return chain
}
