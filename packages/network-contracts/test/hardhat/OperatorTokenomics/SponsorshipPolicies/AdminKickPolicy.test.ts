import { expect } from "chai"
import { ethers as hardhatEthers } from "hardhat"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp, VOTE_KICK } from "../utils"

import { deploySponsorshipWithoutFactory } from "../deploySponsorshipContract"

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

    it("doesn't penalize a kicked operator like it penalizes a leaving operator", async function(): Promise<void> {
        // time:        0 ... 100 ... 200 ... 300
        // join/leave: +b1    +b2   b1 kick  b2 leave
        // operator1:       100  +  50                = 150
        // operator2:               50   +  100       = 150 - penalty 100  = 50
        const { token, adminKickPolicy } = contracts
        await (await token.mint(operator.address, parseEther("10000"))).wait()
        await (await token.mint(operator2.address, parseEther("10000"))).wait()
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {
            penaltyPeriodSeconds: 1000,
        }, [], [], undefined, undefined, adminKickPolicy)

        await sponsorship.sponsor(parseEther("10000"))

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("10000"), await operator.getAddress())).wait()

        await advanceToTimestamp(timeAtStart + 100, "operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("10000"), operator2.address)).wait()

        // event OperatorKicked(address indexed operator, uint slashedWei);
        const operatorCountBeforeKick = await sponsorship.operatorCount()
        await advanceToTimestamp(timeAtStart + 200, "operator 1 is kicked out")
        expect (await sponsorship.connect(admin).flag(await operator.getAddress(), ""))
            .to.emit(sponsorship, "OperatorKicked")
            .withArgs(await operator.getAddress(), "0")
        const operatorCountAfterKick = await sponsorship.operatorCount()

        await advanceToTimestamp(timeAtStart + 300, "operator 2 leaves and gets slashed")
        await (await sponsorship.connect(operator2).forceUnstake()).wait()

        expect(operatorCountBeforeKick.toString()).to.equal("2")
        expect(operatorCountAfterKick.toString()).to.equal("1")
        expect(formatEther(await token.balanceOf(operator.address))).to.equal("10150.0")
        expect(formatEther(await token.balanceOf(operator2.address))).to.equal("5150.0")
    })

    it("doesn't allow non-admins to kick", async function(): Promise<void> {
        const { token, adminKickPolicy } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], undefined, undefined, adminKickPolicy)
        await (await token.mint(operator.address, parseEther("10000"))).wait()
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("10000"), await operator.getAddress())).wait()

        const operatorCountBeforeReport = await sponsorship.operatorCount()
        expect(sponsorship.connect(operator2).flag(await operator.getAddress(), ""))
            .to.emit(sponsorship, "OperatorKicked").withArgs(await operator.getAddress())
        const operatorCountAfterReport = await sponsorship.operatorCount()

        expect(operatorCountBeforeReport.toString()).to.equal("1")
        expect(operatorCountAfterReport.toString()).to.equal("1")
    })

    it("doesn't do voting", async function(): Promise<void> {
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], undefined, undefined, contracts.adminKickPolicy)
        await expect(sponsorship.voteOnFlag(AddressZero, VOTE_KICK)).to.not.be.reverted
        const flag = await sponsorship.getFlag(AddressZero)
        expect(flag.flagData).to.equal(parseEther("0"))
        expect(flag.flagMetadata).to.equal("")
    })
})
