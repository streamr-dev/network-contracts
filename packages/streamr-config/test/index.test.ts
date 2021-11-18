import { describe, it } from "mocha"
import { assert } from "chai"
import { loadConfig } from "../src/index"

describe("Package exports network details from JSON file", () => {
  it("Mainchain chainId is 1", () => {
    const c = loadConfig()
    const chainId = c.get("mainchain")?.chainId
    assert.isNumber(chainId)
    const expected = 1
    assert.equal(chainId, expected, `Expecting mainchain chainId to equal ${expected}`)
  })
})
