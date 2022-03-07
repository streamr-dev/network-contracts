import { describe, it } from "mocha"
import { assert } from "chai"
import { Chains, RPCProtocol, loadConfigFromNodeEnv } from "../src/index"

describe("Load configuration from JSON file", () => {
    it("ethereum chain id is 1", () => {
        const chains: Chains = Chains.load("production")
        const chainId: number = chains.ethereum.id
        const expected = 1
        assert.equal(chainId, expected, `Expecting ethereum prod chain id to equal ${expected}, got '${chainId}'`)
    })
    it("development chain id is 8995", () => {
        const chains: Chains = Chains.load("development")
        const chainId: number = chains.ethereum.id
        const expected = 8995
        assert.equal(chainId, expected, `Expecting ethereum dev chain id to equal ${expected}, got '${chainId}'`)
    })
    it("reads DATA token dev address from JSON", () => {
        const chains: Chains = Chains.load("development")
        const address = chains.ethereum.contracts["DATA-token"]
        const expected = "0xbAA81A0179015bE47Ad439566374F2Bae098686F"
        assert.equal(address, expected, `Expecting ethereum DATA token to equal ${expected}, got '${address}'`)
    })
    it("reads prod Polygon RPC URL", () => {
        const chains: Chains = Chains.load("production")
        const rpcHttpUrl = chains.polygon.rpcEndpoints[0].url
        const expected = "https://polygon-rpc.com"
        assert.equal(rpcHttpUrl, expected, `Expecting prod polygon RPC URL to equal ${expected}, got '${rpcHttpUrl}'`)
    })
    it("finds RPC endpoints by protocol", () => {
        const chains: Chains = Chains.load("production")
        const endpoints = chains.binance.getRPCEndpointsByProtocol(RPCProtocol.HTTP)
        assert.equal(endpoints.length, 1)
        assert.equal(endpoints[0].url, "https://bsc-dataseed.binance.org")
    })
})
describe("Load configuration based on NODE_ENV environment variable", () => {
    it("ethereum chain id is 1", () => {
        process.env.NODE_ENV = "production"
        const config: Chains = loadConfigFromNodeEnv()
        const chainId: number = config.ethereum.id
        const expected = 1
        assert.equal(chainId, expected, `Expecting ethereum prod chain id to equal ${expected}, got '${chainId}'`)
    })
    it("development chain id is 8995", () => {
        process.env.NODE_ENV = "development"
        const config: Chains = loadConfigFromNodeEnv()
        const chainId: number = config.ethereum.id
        const expected = 8995
        assert.equal(chainId, expected, `Expecting ethereum dev chain id to equal ${expected}, got '${chainId}'`)
    })
    it("errors when NODE_ENV is not set", () => {
        delete process.env.NODE_ENV
        assert.throws(() => {
            /* eslint-disable @typescript-eslint/no-unused-vars */
            const config: Chains = loadConfigFromNodeEnv()
        }, /NODE_ENV environment variable is not set/)
    })
    it("errors when NODE_ENV is something else than 'production' or 'development'", () => {
        process.env.NODE_ENV = "dev"
        assert.throws(() => {
            /* eslint-disable @typescript-eslint/no-unused-vars */
            const config: Chains = loadConfigFromNodeEnv()
        }, /NODE_ENV environment variable value must be either 'production' or 'development'/)
    })
})