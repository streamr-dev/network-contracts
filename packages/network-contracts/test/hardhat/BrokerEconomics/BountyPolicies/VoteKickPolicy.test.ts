import { ethers } from "hardhat"
import { BigNumber, utils, Wallet, ContractReceipt } from "ethers"
import { expect } from "chai"

import { deployTestContracts } from "../deployTestContracts"
import { deployBountyContract } from "../deployBountyContract"
import { deployBrokerPool } from "../deployBrokerPool"
import assert from "assert"

const { parseEther, id } = utils

const VOTE_KICK = "0x0000000000000000000000000000000000000000000000000000000000000001"
const VOTE_CANCEL = "0x0000000000000000000000000000000000000000000000000000000000000000"

describe("VoteKickPolicy", (): void => {

    // default setup for test cases that don't need a clean set of contracts
    // clean setup is needed when review selection has to be controlled (so that BrokerPools from old tests don't interfere)
    let defaultSetup: any
    before(async (): Promise<void> => {
        defaultSetup = await setup(3, 1)
    })

    /**
     * Sets up a Bounty and given number of brokers, each with BrokerPool that stakes 1000 tokens into the Bounty
     */
    async function setup(stakedBrokerCount = 3, nonStakedBrokerCount = 0, bountySettings: any = {}, testTitle?: string) {
        // Hardhat provides 20 pre-funded signers
        const [admin, ...signers] = await ethers.getSigners() as unknown as Wallet[]
        const stakedBrokers = signers.slice(0, stakedBrokerCount)
        const nonStakedBrokers = signers.slice(stakedBrokerCount, stakedBrokerCount + nonStakedBrokerCount)

        const contracts = await deployTestContracts(admin)

        const brokers = [...stakedBrokers, ...nonStakedBrokers]

        // minting must happen one by one since it's all done from admin account
        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        for (const b of brokers) {
            await (await token.mint(b.address, parseEther("1000"))).wait()
        }

        // no risk of nonce collisions in Promise.all since each broker has their own separate nonce
        const pools = await Promise.all(brokers.map((b) => deployBrokerPool(contracts, b, {}, testTitle)))
        await Promise.all(brokers.map((b, i) => token.connect(b).transferAndCall(pools[i].address, parseEther("1000"), "0x")))

        const bounty = await deployBountyContract(contracts, {
            allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 0,
            brokerPoolOnly: true,
            ...bountySettings
        })
        await bounty.sponsor(parseEther("10000"))

        await Promise.all(stakedBrokers.map((_, i) => pools[i].stake(bounty.address, parseEther("1000"))))

        return {
            contracts,
            token,
            admin,
            bounty,
            brokers,
            stakedBrokers,
            nonStakedBrokers,
            pools,
        }
    }

    describe("Flagging + voting + resolution (happy path)", (): void => {
        it("with one flagger, one target and 1 voter", async function(): Promise<void> {
            const { token, bounty, brokers: [ broker, _, broker3 ], pools: [ pool1, pool2 ] } = await setup(3, 0, {}, this.test?.title)

            const flagReceipt = await (await bounty.connect(broker).flag(pool2.address, pool1.address)).wait() as ContractReceipt
            expect(flagReceipt.events!.filter((e) => e.event === "ReviewRequest")).to.have.length(1)
            const reviewRequest = flagReceipt.events!.find((e) => e.event === "ReviewRequest")
            expect(reviewRequest?.args?.bounty).to.equal(bounty.address)
            expect(reviewRequest?.args?.target).to.equal(pool2.address)
            expect(reviewRequest?.args?.reviewer).to.equal(broker3.address)

            await expect(bounty.connect(broker3).voteOnFlag(pool2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(pool2.address, parseEther("100"))
            expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))
        })

        it("with 3 voters", async function(): Promise<void> {
            const { token, bounty, brokers: [ broker, _, broker3, broker4, broker5 ], 
                pools: [ pool1, flaggedPool ] } = await setup(5, 0, {}, this.test?.title)

            const flagReceipt = await (await bounty.connect(broker).flag(flaggedPool.address, pool1.address)).wait() as ContractReceipt
            const reviewRequests = flagReceipt.events!.filter((e) => e.event === "ReviewRequest")
            expect(reviewRequests.length).to.equal(3)
            reviewRequests.forEach((reviewRequest) => {
                expect(reviewRequest.args?.bounty).to.equal(bounty.address)
                expect(reviewRequest.args?.target).to.equal(flaggedPool.address)
                expect([broker3.address, broker4.address, broker5.address]).to.include(reviewRequest.args?.reviewer)
            })

            await expect(bounty.connect(broker3).voteOnFlag(flaggedPool.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(broker4).voteOnFlag(flaggedPool.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(broker5).voteOnFlag(flaggedPool.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(flaggedPool.address, parseEther("100"))
            expect(await token.balanceOf(flaggedPool.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(broker3.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(broker4.address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(broker5.address)).to.equal(parseEther("1"))
        })

        it("with 2 flags active at the same time (not interfere with each other)", async function(): Promise<void> {
            const { token, bounty, brokers: [ flagger1, flagger2, broker3, broker4 ], 
                pools: [ pool1, pool2, target1, target2 ],
                nonStakedBrokers: [voter1, voter2, voter3] } = await setup(4, 3, {}, this.test?.title)

            const flagReceipt1 = await (await bounty.connect(flagger1).flag(target1.address, pool1.address)).wait() as ContractReceipt
            const reviewRequests1 = flagReceipt1.events!.filter((e) => e.event === "ReviewRequest")
            expect(reviewRequests1.length).to.equal(5)
            reviewRequests1.forEach((reviewRequest) => {
                expect(reviewRequest.args?.bounty).to.equal(bounty.address)
                expect(reviewRequest.args?.target).to.equal(target1.address)
                expect([voter1.address, voter2.address, voter3.address, flagger2.address, broker4.address])
                    .to.include(reviewRequest.args?.reviewer)
            })
            const flagReceipt2 = await (await bounty.connect(flagger2).flag(target2.address, pool2.address)).wait() as ContractReceipt
            const reviewRequests2 = flagReceipt2.events!.filter((e) => e.event === "ReviewRequest")
            expect(reviewRequests2.length).to.equal(5)
            reviewRequests2.forEach((reviewRequest) => {
                expect(reviewRequest.args?.bounty).to.equal(bounty.address)
                expect(reviewRequest.args?.target).to.equal(target2.address)
                expect([voter1.address, voter2.address, voter3.address, flagger1.address, broker3.address])
                    .to.include(reviewRequest.args?.reviewer)
            })

            await expect(bounty.connect(voter1).voteOnFlag(target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(voter2).voteOnFlag(target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(voter3).voteOnFlag(target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(voter3).voteOnFlag(target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(voter2).voteOnFlag(target1.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target1.address, parseEther("100"))
            await expect(bounty.connect(voter1).voteOnFlag(target2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target2.address, parseEther("100"))

            expect(await token.balanceOf(target1.address)).to.equal(parseEther("900"))
            expect(await token.balanceOf(target2.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(voter1.address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(voter2.address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(voter3.address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(voter3.address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(flagger1.address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(flagger2.address)).to.equal(parseEther("0"))
        })
    })

    describe("Flagging + reviewer selection", function(): void {
        it("picks first brokers that are not in the same bounty", async () => {
            // TODO
        })

        it("does NOT allow to flag with a too small flagstakes", async function(): Promise<void> {
            // TODO
        })

        it("does NOT allow to flag a broker that is already flagged", async function(): Promise<void> {
            // TODO
        })

        it("does NOT allow to flag a broker that is not in the bounty", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], pools: [ flaggerPool,,, notStakedPool ] } = await defaultSetup
            await expect(bounty.connect(flagger).flag(notStakedPool.address, flaggerPool.address))
                .to.be.revertedWith("error_flagTargetNotStaked")
        })
    })

    describe("Timeout", function(): void {
        it("because of a tie (where all voters did vote)", async function(): Promise<void> {
            // TODO
        })

        it("because of not enough voters voted", async function(): Promise<void> {
            // TODO
        })
    })

    describe("Flag resolution", function(): void {
        it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
            // TODO
        })
    })

    describe("Canceling a flag", function(): void {
        it("works (happy path)", async function(): Promise<void> {
            // cancel after some voter has voted (not all), pay the ones who voted
            // broker flags broker2, broker3 votes, broker4 doesn't vote, broker cancels
            const { token, bounty, brokers: [ flagger, _, voter, nonVoter ], pools: [ flaggerPool, flagTarget ] } = await setup(4)

            await (await bounty.connect(flagger).flag(flagTarget.address, flaggerPool.address)).wait()

            await expect(bounty.connect(voter).voteOnFlag(flagTarget.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            await(await bounty.connect(flagger).cancelFlag(flagTarget.address, flaggerPool.address)).wait()
            // expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(voter.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(nonVoter.address)).to.equal(parseEther("0"))
            // expect (await token.balanceOf(broker5.address)).to.equal(parseEther("1"))
        })
    })

    describe("Committed stake", (): void => {
        it("allows the target to withdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], 
                pools: [ flaggerPool, targetPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, {}, this.currentTest?.title)

            const flagReceipt1 = await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt
            const reviewRequest = flagReceipt1.events!.find((e) => e.event === "ReviewRequest")
            // expect(reviewRequests.length).to.equal(1)
            expect(reviewRequest?.args?.reviewer).to.equal(voter1.address)

            await expect(targetPool.unstake(bounty.address, parseEther("0")))
                .to.emit(bounty, "BrokerLeft").withArgs(targetPool.address, parseEther("900"))
        })

        it("allows the target to withdraw the correct amount AFTER the flag period (not kicked)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], 
                pools: [ flaggerPool, targetPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, {}, this.currentTest?.title)

            const flagReceipt1 = await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt
            const reviewRequest = flagReceipt1.events!.find((e) => e.event === "ReviewRequest")
            // expect(reviewRequests.length).to.equal(1)
            expect(reviewRequest?.args?.reviewer).to.equal(voter1.address)

            await expect(bounty.connect(voter1).voteOnFlag(targetPool.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")

            await expect(targetPool.unstake(bounty.address, parseEther("0")))
                .to.emit(bounty, "BrokerLeft").withArgs(targetPool.address, parseEther("1000"))
        })

        it("allows the flagger to withdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], pools: [ flaggerPool, targetPool] } = await setup(2, 1, {}, this.currentTest?.title)

            await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt

            await expect(flaggerPool.unstake(bounty.address, parseEther("0")))
                .to.emit(bounty, "BrokerLeft").withArgs(flaggerPool.address, parseEther("990"))
        })

        it("allows the flagger to withdraw the correct amount AFTER the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], 
                pools: [ flaggerPool, targetPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, {}, this.currentTest?.title)

            const flagReceipt1 = await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt
            const reviewRequest = flagReceipt1.events!.find((e) => e.event === "ReviewRequest")
            // expect(reviewRequests.length).to.equal(1)
            expect(reviewRequest?.args?.reviewer).to.equal(voter1.address)

            await expect(bounty.connect(voter1).voteOnFlag(targetPool.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")

            await expect(flaggerPool.unstake(bounty.address, parseEther("0")))
                .to.emit(bounty, "BrokerLeft").withArgs(flaggerPool.address, parseEther("990"))
        })

    })
})