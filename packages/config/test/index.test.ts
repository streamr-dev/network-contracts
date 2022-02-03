import { describe, it } from "mocha"
import { assert } from "chai"
import { Address, Chains, loadConfig } from "../src/index"

describe("Package exports network details from JSON file", () => {
  it("ethereum chain id is 1", () => {
    const config: Chains = loadConfig("production")
    const chainId: number = config.ethereum.id
    const expected = 1
    assert.equal(chainId, expected, `Expecting ethereum prod chain id to equal ${expected}, got ${chainId}`)
  })
  it("development chain id is 8995", () => {
    const config: Chains = loadConfig("development")
    const chainId: number = config.ethereum.id
    const expected = 8995
    assert.equal(chainId, expected, `Expecting ethereum dev chain id to equal ${expected}, got ${chainId}`)
  })
  it("reads DATA token dev address from JSON", () => {
    const config: Chains = loadConfig("development")
    const address: Address = config.ethereum.contracts["DATA-token"]
    const expected = "0xbAA81A0179015bE47Ad439566374F2Bae098686F"
    assert.equal(address, expected, `Expecting ethereum DATA token to equal ${expected}, got ${address.toString()}`)
  })
})