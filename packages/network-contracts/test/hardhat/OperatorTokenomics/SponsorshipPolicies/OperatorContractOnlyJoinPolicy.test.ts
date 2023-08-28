import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

import { Operator } from "../../../../typechain"

const { parseEther } = ethersUtils
const { getSigners, getContractFactory } = hardhatEthers

import {
    deployTestContracts,
    TestContracts,
} from "../deployTestContracts"
import { deployOperatorContract } from "../deployOperatorContract"
import { deploySponsorship } from "../deploySponsorshipContract"

describe("OperatorContractOnlyJoinPolicy", (): void => {
    let admin: Wallet
    let operator: Wallet

    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, operator] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(operator.address, parseEther("1000"))).wait()
    })

    it("only allows Operators to stake", async function(): Promise<void> {
        const { streamrConfig, token } = contracts
        const sponsorship = await deploySponsorship(contracts)

        await (await token.approve(sponsorship.address, parseEther("100"))).wait()
        await expect(sponsorship.stake(operator.address, parseEther("100")))
            .to.be.revertedWith("error_onlyOperators")

        const badOp = await (await (await getContractFactory("Operator", operator)).deploy()).deployed() as Operator
        await (await badOp.initialize(token.address, streamrConfig.address, operator.address, "testpool", "{}", "1")).wait()
        await (await token.connect(operator).transferAndCall(badOp.address, parseEther("100"), "0x")).wait()
        await expect(badOp.stake(sponsorship.address, parseEther("100")))
            .to.be.revertedWith("error_onlyOperators")

        const goodOp = await deployOperatorContract(contracts, operator)
        await (await token.connect(operator).transferAndCall(goodOp.address, parseEther("100"), "0x")).wait()
        await expect(goodOp.stake(sponsorship.address, parseEther("100")))
            .to.emit(sponsorship, "OperatorJoined").withArgs(goodOp.address)
            .to.emit(goodOp, "Staked")
    })
})
