import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { OperatorClient } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther } from "@ethersproject/units"

import type { Operator } from "../../network-contracts/typechain"
import { ContractFactory } from "@ethersproject/contracts"
import { abi as operatorAbi, bytecode as operatorBytecode } 
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/Operator.sol/Operator.json"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

describe("OperatorClient", async () => {
    const config = Chains.load()["dev1"]
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    const sponsorshipAddress = "0x93B517f6014F930631Cb4AD4F7d329b453Bd87d9"
    const operatorAddress = "0xb7BFd245d932163b68e6796C8D08D022Bc391E9a"
    const operatorPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"
    let operator: Operator

    before(async () => {
        provider = new JsonRpcProvider(chainURL)

        const operatorWallet = new Wallet(operatorPrivKey, provider)

        const  operatorFactory = new ContractFactory(operatorAbi, operatorBytecode, operatorWallet)

        operator = await operatorFactory.attach(operatorAddress) as unknown as Operator
        // eslint-disable-next-line require-atomic-updates
        operator = await operator.deployed() // checks for bytecode match
    })

    it("emits addStakedStream only when the first Sponsorship for a stream is staked to", async () => {
        new OperatorClient(operatorAddress, provider)
        const tr = await (await operator.stake(sponsorshipAddress, parseEther("1"))).wait()
        log(tr)
    })

    it("emits removeStakedStream only when the last Sponsorship for a stream was unstaked from", () => {
        new OperatorClient(operatorAddress, provider)
    })
})
