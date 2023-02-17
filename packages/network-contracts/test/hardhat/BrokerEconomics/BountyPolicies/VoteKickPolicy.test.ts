import { ethers } from "hardhat"
import { BigNumber, utils, Wallet } from "ethers"
import { expect } from "chai"

import { deployTestContracts } from "../deployTestContracts"
import { deployBountyContract } from "../deployBountyContract"
import { deployBrokerPool } from "../deployBrokerPool"

const { parseEther } = utils

describe("VoteKickPolicy", (): void => {
    let admin: Wallet
    let broker: Wallet
    let broker2: Wallet
    let broker3: Wallet
    let broker4: Wallet
    let broker5: Wallet

    before(async (): Promise<void> => {
        [admin, broker, broker2, broker3, broker4, broker5] = await ethers.getSigners() as unknown as Wallet[]
    })

    it("allows to kick a broker by flagging and voting", async function(): Promise<void> {
        const contracts = await deployTestContracts(admin)
        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.mint(broker.address, parseEther("1000000"))).wait()
        await (await token.mint(broker2.address, parseEther("1000000"))).wait()
        const pool1 = await deployBrokerPool(contracts, broker)
        const pool2 = await deployBrokerPool(contracts, broker2)
        await deployBrokerPool(contracts, broker3)
        await (await token.connect(broker).transferAndCall(pool1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(broker2).transferAndCall(pool2.address, parseEther("1000"), "0x")).wait()
        const bounty = await deployBountyContract(contracts, { allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 1000, brokerPoolOnly: true })
        await bounty.sponsor(parseEther("10000"))
        await pool1.stake(bounty.address, parseEther("1000"))
        await pool2.stake(bounty.address, parseEther("1000"))

        const flagReceipt = await (await bounty.connect(broker).flag(pool2.address, pool1.address)).wait()
        expect(flagReceipt.events.filter((e: any) => e.event === "ReviewRequest")).to.have.length(1)
        const reviewRequest = flagReceipt.events.find((e: any) => e.event === "ReviewRequest")
        expect(reviewRequest.args?.bounty).to.equal(bounty.address)
        expect(reviewRequest.args?.target).to.equal(pool2.address)
        expect(reviewRequest.args?.reviewer).to.equal(broker3.address)

        await expect(bounty.connect(broker3).voteOnFlag(pool2.address, "0x0000000000000000000000000000000000000000000000000000000000000001"))
            .to.emit(bounty, "BrokerKicked").withArgs(pool2.address, parseEther("100"))
        expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))
    })

    it("works with an odd amount of voters (more than one)", async function(): Promise<void> {
        const badActorBroker = new Wallet("0x0000000000000000000000000000000000000000000000000000000000000002", admin.provider)
        await (await admin.sendTransaction({ to: badActorBroker.address, value: parseEther("1") })).wait()
        const contracts = await deployTestContracts(admin)
        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.mint(broker.address, parseEther("1000000"))).wait()
        await (await token.mint(broker2.address, parseEther("100000"))).wait()
        await (await token.mint(badActorBroker.address, parseEther("1000000"))).wait()

        const pool1 = await deployBrokerPool(contracts, broker)
        const pool2 = await deployBrokerPool(contracts, badActorBroker, {}, "pool2salt")
        await deployBrokerPool(contracts, broker3)
        await deployBrokerPool(contracts, broker4)
        await deployBrokerPool(contracts, broker5)

        await (await token.connect(broker).transferAndCall(pool1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(badActorBroker).transferAndCall(pool2.address, parseEther("1000"), "0x")).wait()
        const bounty = await deployBountyContract(contracts, { allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 1000, brokerPoolOnly: true })
        await bounty.sponsor(parseEther("10000"))
        await pool1.stake(bounty.address, parseEther("1000"))
        await pool2.stake(bounty.address, parseEther("1000"))

        const flagReceipt = await (await bounty.connect(broker).flag(pool2.address, pool1.address)).wait()
        const reviewRequests = flagReceipt.events.filter((e: any) => e.event === "ReviewRequest")
        expect(reviewRequests.length).to.equal(3)
        reviewRequests.forEach((reviewRequest: any) => {
            expect(reviewRequest.args?.bounty).to.equal(bounty.address)
            expect(reviewRequest.args?.target).to.equal(pool2.address)
            expect([broker3.address, broker4.address, broker5.address]).to.include(reviewRequest.args?.reviewer)
        })

        await expect(bounty.connect(broker3).voteOnFlag(pool2.address, "0x0000000000000000000000000000000000000000000000000000000000000001"))
            .to.not.emit(bounty, "BrokerKicked")
        await expect(bounty.connect(broker4).voteOnFlag(pool2.address, "0x0000000000000000000000000000000000000000000000000000000000000000"))
            .to.not.emit(bounty, "BrokerKicked")
        await expect(bounty.connect(broker5).voteOnFlag(pool2.address, "0x0000000000000000000000000000000000000000000000000000000000000001"))
            .to.emit(bounty, "BrokerKicked").withArgs(pool2.address, parseEther("100"))
        expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))

        expect (await token.balanceOf(broker3.address)).to.equal(parseEther("1"))
        expect (await token.balanceOf(broker4.address)).to.equal(parseEther("0"))
        expect (await token.balanceOf(broker5.address)).to.equal(parseEther("1"))
    })

    it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
        // TODO
    })

    it("allows the flagger to wighdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
        // TODO
    })

    it("allows the flagger to wighdraw the correct amount AFTER the flag period", async function(): Promise<void> {
        // TODO
    })

    it("allows 2 flags to be active at the same time and not interfere with each other", async function(): Promise<void> {
        // TODO
    })

    it("works with an even amount of voters (times out)", async function(): Promise<void> {
        // TODO
    })

    it("does NOT allow to flag with a too small flagstakes", async function(): Promise<void> {
        // TODO
    })

    it("allowes to cancel a flag", async function(): Promise<void> {
        // cancel after some voter has voted (not all), pay the ones who voted
        // broker flags broker2, broker3 votes, broker4 doesn't vote, broker cancels
        const contracts = await deployTestContracts(admin)
        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.mint(broker.address, parseEther("1000000"))).wait()
        await (await token.mint(broker2.address, parseEther("100000"))).wait()

        const pool1 = await deployBrokerPool(contracts, broker)
        const pool2 = await deployBrokerPool(contracts, broker2)
        await deployBrokerPool(contracts, broker3)
        await deployBrokerPool(contracts, broker4)

        await (await token.connect(broker).transferAndCall(pool1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(broker2).transferAndCall(pool2.address, parseEther("1000"), "0x")).wait()
        const bounty = await deployBountyContract(contracts, { allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 1000, brokerPoolOnly: true })
        await bounty.sponsor(parseEther("10000"))
        await pool1.stake(bounty.address, parseEther("1000"))
        await pool2.stake(bounty.address, parseEther("1000"))

        await (await bounty.connect(broker).flag(pool2.address, pool1.address)).wait()

        await expect(bounty.connect(broker3).voteOnFlag(pool2.address, "0x0000000000000000000000000000000000000000000000000000000000000001"))
            .to.not.emit(bounty, "BrokerKicked")
        
        await(await bounty.connect(broker).cancelFlag(pool2.address, pool1.address)).wait()
        // expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))

        expect (await token.balanceOf(broker3.address)).to.equal(parseEther("1"))
        expect (await token.balanceOf(broker4.address)).to.equal(parseEther("0"))
        // expect (await token.balanceOf(broker5.address)).to.equal(parseEther("1"))
    })

    it("does NOT allow to flag a broker that is already flagged", async function(): Promise<void> {
        // TODO
    })

    it("does NOT allow to flag a broker that is not in the bounty", async function(): Promise<void> {
        // TODO
    })

})