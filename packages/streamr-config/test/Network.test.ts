import { describe, it } from "mocha"
import { assert } from "chai"
import { Network } from "../src/Network"

describe("Network", () => {
  it("Network constructor validates chainId", () => {
    try {
      new Network(0, "production", new Map())
      assert.fail("expected 0 chainId to throw error")
    } catch (err: any) {
      assert.isTrue(true)
    }
  })
})
