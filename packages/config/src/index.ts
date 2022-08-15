import networksAsJSON from "./networks.json"

export { networksAsJSON as networks }

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
    ) { }
}

interface ChainJSON {
    readonly id: number
    readonly rpcEndpoints: RPCEndpointJSON[]
    readonly contracts: ContractsJSON
}

export class Chain implements ChainJSON {
    constructor(
        public readonly name: string,
        public readonly id: number,
        public rpcEndpoints: RPCEndpoint[],
        public contracts: Contracts,
    ) {
        if (name === "") {
            throw new Error("Chain name is required")
        }
        this.name = name
        if (id < 0) {
            throw new Error("Chain ID cannot be negative")
        }
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

    toString(): string {
        return this.name.toLowerCase()
    }
}

interface ChainsJSON {
    readonly [name: string]: ChainJSON
}

export class Chains implements ChainsJSON {
    [name: string]: Chain
    public static load(): Chains {
        const chainsJson: ChainsJSON = networksAsJSON
        const chains: Chains = ChainsFactory.create(chainsJson)
        return chains
    }
}

class ChainsFactory {
    private constructor() { }
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
            chains[key] = new Chain(key, chainJson.id, rpcEndpoints, contracts)
        }
        return chains
    }
}
