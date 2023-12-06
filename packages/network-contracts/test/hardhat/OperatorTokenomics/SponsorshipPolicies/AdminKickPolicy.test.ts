import { expect } from "chai"
import { ethers as hardhatEthers } from "hardhat"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp, VOTE_KICK } from "../utils"

import { deploySponsorshipWithoutFactory } from "../deploySponsorshipWithoutFactory"

import type { Wallet } from "ethers"

const {
    getSigners,
    constants: { AddressZero },
    utils: { parseEther, formatEther },
} = hardhatEthers

describe("AdminKickPolicy", (): void => {
    let admin: Wallet
    let operator: Wallet
    let operator2: Wallet

    let contracts: TestContracts
    before(async (): Promise<void> => {
        [admin, operator, operator2] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
    })

    it("forcibly unstakes (happy path)", async function(): Promise<void> {
        const { token, adminKickPolicy } = contracts
        await (await token.mint(operator.address, parseEther("10000"))).wait()
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], undefined, undefined, adminKickPolicy)
        await (await token.transferAndCall(sponsorship.address, parseEther("10000"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "operator joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("10000"), await operator.address)).wait()

        const operatorCountBeforeKick = await sponsorship.operatorCount()
        await advanceToTimestamp(timeAtStart + 200, "operator is kicked out")
        expect (await sponsorship.connect(admin).flag(operator.address, "")).to.emit(sponsorship, "OperatorKicked")
        const operatorCountAfterKick = await sponsorship.operatorCount()

        expect(operatorCountBeforeKick.toString()).to.equal("1")
        expect(operatorCountAfterKick.toString()).to.equal("0")
        expect(formatEther(await token.balanceOf(operator.address))).to.equal("10200.0")
    })

    it("doesn't allow non-admins to kick", async function(): Promise<void> {
        const { token, adminKickPolicy } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], undefined, undefined, adminKickPolicy)
        await (await token.mint(operator.address, parseEther("10000"))).wait()
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("10000"), await operator.address)).wait()

        const operatorCountBeforeFlag = await sponsorship.operatorCount()
        expect(sponsorship.connect(operator2).flag(await operator.getAddress(), ""))
            .to.emit(sponsorship, "OperatorKicked").withArgs(await operator.getAddress())
        const operatorCountAfterFlag = await sponsorship.operatorCount()

        expect(operatorCountBeforeFlag.toString()).to.equal("1")
        expect(operatorCountAfterFlag.toString()).to.equal("1")
    })

    it("doesn't do voting", async function(): Promise<void> {
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], undefined, undefined, contracts.adminKickPolicy)
        await expect(sponsorship.voteOnFlag(AddressZero, VOTE_KICK)).to.not.be.reverted
        const flag = await sponsorship.getFlag(AddressZero)
        expect(flag.flagData).to.equal(parseEther("0"))
        expect(flag.flagMetadata).to.equal("")
    })
})
