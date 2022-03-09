import networksAsJSON from "./networks.json"

interface ContractsJSON {
    readonly [name: string]: string
}
export class Contracts implements ContractsJSON {
    [name: string]: string
}

export enum RPCProtocol {
    HTTP,
    WEBSOCKET
}

interface RPCEndpointJSON {
    readonly url: string
}

export class RPCEndpoint implements RPCEndpointJSON {
    constructor(
        readonly url: string,
        //readonly readTimeoutSecond: int,
        //readonly writeTimeoutSecond: int,
    ) {}
}

interface ChainJSON {
    readonly id: number
    readonly rpcEndpoints: RPCEndpointJSON[]
    readonly contracts: ContractsJSON
}

export class Chain implements ChainJSON {
    constructor(
        public readonly id: number,
        public rpcEndpoints: RPCEndpoint[],
        public contracts: Contracts,
    ) {
        this.id = id
        this.rpcEndpoints = new Array<RPCEndpoint>()
        for (const rpcEndpoint of rpcEndpoints) {
            this.rpcEndpoints.push(new RPCEndpoint(rpcEndpoint.url))
        }
        this.contracts = new Contracts()
        for (const key of Object.keys(contracts)) {
            this.contracts[key] = contracts[key]
        }
    }
    getRPCEndpointsByProtocol(protocol: RPCProtocol): RPCEndpoint[] {
        const endpoints = new Array<RPCEndpoint>()
        for (const rpcEndpoint of this.rpcEndpoints) {
            if (protocol === RPCProtocol.HTTP) {
                if (rpcEndpoint.url.startsWith("https://") || rpcEndpoint.url.startsWith("http://")) {
                    endpoints.push(new RPCEndpoint(rpcEndpoint.url))
                }
            } else if (protocol === RPCProtocol.WEBSOCKET) {
                if (rpcEndpoint.url.startsWith("wss://") || rpcEndpoint.url.startsWith("ws://")) {
                    endpoints.push(new RPCEndpoint(rpcEndpoint.url))
                }
            }
        }
        return endpoints
    }
}

export type Environment = "development" | "production"

type NetworksJSON = {
    readonly [env in Environment]: ChainsJSON
}

interface ChainsJSON {
    readonly [name: string]: ChainJSON
}

export class Chains implements ChainsJSON {
    [name: string]: Chain
    public static load(env: Environment): Chains {
        const networks: NetworksJSON = networksAsJSON
        const chainsJson: ChainsJSON = networks[env]
        const chains: Chains = ChainsFactory.create(chainsJson)
        return chains
    }
    public static loadFromNodeEnv(): Chains {
        const nodeEnv = process.env.NODE_ENV
        if (nodeEnv === undefined) {
            throw new Error("NODE_ENV environment variable is not set")
        }
        if (nodeEnv !== "production" && nodeEnv !== "development") {
            throw new Error("NODE_ENV environment variable value must be either 'production' or 'development'")
        }
        const env: Environment = nodeEnv
        return Chains.load(env)
    }
}

class ChainsFactory {
    private constructor() {}
    static create(chainsJson: ChainsJSON): Chains {
        const chains = new Chains()
        for (const key in chainsJson) {
            const chainJson: ChainJSON = chainsJson[key]
            const rpcEndpoints = new Array<RPCEndpoint>()
            for (const rpcEndpoint of chainJson.rpcEndpoints) {
                rpcEndpoints.push(new RPCEndpoint(rpcEndpoint.url))
            }
            const contracts = new Contracts()
            for (const key of Object.keys(chainJson.contracts)) {
                contracts[key] = chainJson.contracts[key]
            }
            chains[key] = new Chain(chainJson.id, rpcEndpoints, contracts)
        }
        return chains
    }
}
