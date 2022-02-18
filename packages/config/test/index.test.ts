import { describe, it } from "mocha"
import { assert } from "chai"
import { Chains, loadConfig, loadConfigFromNodeEnv } from "../src/index"

describe("Load configuration from JSON file", () => {
    it("ethereum chain id is 1", () => {
        const config: Chains = loadConfig("production")
        const chainId: number = config.ethereum.id
        const expected = 1
        assert.equal(chainId, expected, `Expecting ethereum prod chain id to equal ${expected}, got '${chainId}'`)
    })
    it("development chain id is 8995", () => {
        const config: Chains = loadConfig("development")
        const chainId: number = config.ethereum.id
        const expected = 8995
        assert.equal(chainId, expected, `Expecting ethereum dev chain id to equal ${expected}, got '${chainId}'`)
    })
    it("reads DATA token dev address from JSON", () => {
        const config: Chains = loadConfig("development")
        const address = config.ethereum.contracts["DATA-token"]
        const expected = "0xbAA81A0179015bE47Ad439566374F2Bae098686F"
        assert.equal(address, expected, `Expecting ethereum DATA token to equal ${expected}, got '${address}'`)
    })
    it("reads prod Polygon RPC URL", () => {
        const config: Chains = loadConfig("production")
        const rpcHttpUrl = config.polygon.rpcHttpUrl
        const expected = "https://polygon-rpc.com"
        assert.equal(rpcHttpUrl, expected, `Expecting prod polygon RPC URL to equal ${expected}, got '${rpcHttpUrl}'`)
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