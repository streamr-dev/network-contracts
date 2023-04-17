import { OperatorClient } from "../src/OperatorClient"

describe("OperatorClient", () => {
    it("emits addStakedStream only when the first Sponsorship for a stream is staked to", () => {
        new OperatorClient("asdf", {})
    })

    it("emits removeStakedStream only when the last Sponsorship for a stream was unstaked from", () => {
        new OperatorClient("asdf", {})
    })
})
