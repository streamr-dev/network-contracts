import { describe, it } from "mocha"
import { assert } from "chai"
import { Address } from "../src/Address"

describe("Address", () => {
  it("Gets Address value as string", () => {
    const value = "0x1234567890123456789012345678901234567890"
    const a = new Address(value)
    const expected = value
    assert.equal(a.toString(), expected, `Expecting Address value ${expected}, got ${a.toString()}`)
  })
})
