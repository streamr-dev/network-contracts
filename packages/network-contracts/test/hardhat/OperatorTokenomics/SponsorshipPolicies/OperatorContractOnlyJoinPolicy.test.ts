import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { deployOperatorContract } from "../deployOperatorContract"
import { deploySponsorship } from "../deploySponsorshipContract"

import type { Wallet } from "ethers"
import type { Operator } from "../../../../typechain"

const {
    getSigners,
    getContractFactory,
    utils: { parseEther }
} = hardhatEthers

describe("OperatorContractOnlyJoinPolicy", (): void => {
    let admin: Wallet
    let operator: Wallet

    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, operator] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(operator.address, parseEther("10000"))).wait()
    })

    it("only allows Operators to stake", async function(): Promise<void> {
        const { streamrConfig, token } = contracts
        const sponsorship = await deploySponsorship(contracts)

        await (await token.approve(sponsorship.address, parseEther("5000"))).wait()
        await expect(sponsorship.stake(operator.address, parseEther("5000")))
            .to.be.revertedWith("error_onlyOperators")

        const badOp = await (await (await getContractFactory("Operator", operator)).deploy()).deployed() as Operator
        await (await badOp.initialize(token.address, streamrConfig.address, operator.address, "testpool", "{}", "1",
            [contracts.nodeModule.address, contracts.queueModule.address, contracts.stakeModule.address])).wait()
        await (await badOp.setExchangeRatePolicy(contracts.defaultExchangeRatePolicy.address, "0")).wait()
        await (await token.connect(operator).transferAndCall(badOp.address, parseEther("5000"), "0x")).wait()
        await expect(badOp.stake(sponsorship.address, parseEther("5000")))
            .to.be.revertedWith("error_onlyOperators")

        const goodOp = await deployOperatorContract(contracts, operator)
        await (await token.connect(operator).transferAndCall(goodOp.address, parseEther("5000"), "0x")).wait()
        await expect(goodOp.stake(sponsorship.address, parseEther("5000")))
            .to.emit(sponsorship, "OperatorJoined").withArgs(goodOp.address)
            .to.emit(goodOp, "Staked")
    })
})
