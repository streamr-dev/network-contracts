import { describe, it } from "mocha"
import { assert } from "chai"
import * as config from "../src"

describe("Load configuration from JSON file", () => {
    it("ethereum chain id is 1", () => {
        const chains: config.Chains = config.Chains.load()
        const chainId: number = chains.ethereum.id
        const expected = 1
        assert.equal(chainId, expected, `Expecting ethereum prod chain id to equal ${expected}, got '${chainId}'`)
    })
    it("development chain id is 8995", () => {
        const chains: config.Chains = config.Chains.load()
        const chainId: number = chains.dev0.id
        const expected = 8995
        assert.equal(chainId, expected, `Expecting ethereum dev chain id to equal ${expected}, got '${chainId}'`)
    })
    it("reads DATA token dev address from JSON", () => {
        const chains: config.Chains = config.Chains.load()
        const address = chains.dev0.contracts["DATA"]
        const expected = "0xbAA81A0179015bE47Ad439566374F2Bae098686F"
        assert.equal(address, expected, `Expecting ethereum DATA token to equal ${expected}, got '${address}'`)
    })
    it("reads prod Polygon RPC URL", () => {
        const chains: config.Chains = config.Chains.load()
        const rpcHttpUrl = chains.polygon.rpcEndpoints[0].url
        const expected = "https://polygon-rpc.com"
        assert.equal(rpcHttpUrl, expected, `Expecting prod polygon RPC URL to equal ${expected}, got '${rpcHttpUrl}'`)
    })
    it("finds RPC endpoints by protocol", () => {
        const chains: config.Chains = config.Chains.load()
        const endpoints = chains.binance.getRPCEndpointsByProtocol(config.RPCProtocol.HTTP)
        assert.equal(endpoints.length, 1)
        assert.equal(endpoints[0].url, "https://bsc-dataseed.binance.org")
    })
    it("Chain.toString() returns the name of the chain", () => {
        const chains: config.Chains = config.Chains.load()
        const chain = chains["polygon"]
        assert.equal(chain.toString(), "polygon")
    })
    it("Chain.toString() returns the name of the chain in lowercase", () => {
        const chain = new config.Chain("GNOSIS", 123, new Array<config.RPCEndpoint>(), new config.Contracts())
        assert.equal(chain.toString(), "gnosis")
    })
    describe("Chain constructor", () => {
        const testCases: {
            name: string;
            chain: {
                name: string;
                id: number;
                rpcEndpoints: config.RPCEndpoint[];
                contracts: config.Contracts;
            };
            expectedErrorMessage: string;
        }[] = [
            {
                name: "name cannot be empty",
                chain: {
                    name: "",
                    id: 0,
                    rpcEndpoints: new Array<config.RPCEndpoint>(),
                    contracts: new config.Contracts(),
                },
                expectedErrorMessage: "Chain name is required",
            },
            {
                name: "id cannot be negative",
                chain: {
                    name: "ethereum",
                    id: -1,
                    rpcEndpoints: new Array<config.RPCEndpoint>(),
                    contracts: new config.Contracts(),
                },
                expectedErrorMessage: "Chain ID cannot be negative",
            },
            {
                name: "all good",
                chain: {
                    name: "ethereum",
                    id: 1,
                    rpcEndpoints: new Array<config.RPCEndpoint>(),
                    contracts: new config.Contracts(),
                },
                expectedErrorMessage: "",
            },
        ]
        testCases.forEach((tc) => {
            it(tc.name, async () => {
                try {
                    new config.Chain(tc.chain.name, tc.chain.id, tc.chain.rpcEndpoints, tc.chain.contracts)
                    if (tc.expectedErrorMessage !== "") {
                        assert.fail("expecting error")
                    }
                } catch (err: any) {
                    if (tc.expectedErrorMessage !== "") {
                        assert.equal(err.message, tc.expectedErrorMessage)
                    } else {
                        assert.fail(`unexpected error: "${err}"`)
                    }
                }
            })
        })
    })
})
