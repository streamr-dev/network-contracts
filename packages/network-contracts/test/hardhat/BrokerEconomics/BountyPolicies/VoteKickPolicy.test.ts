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
    async function setup(stakedBrokerCount = 3, nonStakedBrokerCount = 0, bountySettings: any = {}, cleanBrokerCount = 0, cleanBrokerSeed?: string) {
        // Hardhat provides 20 pre-funded signers
        const [admin, ...signers] = await ethers.getSigners() as unknown as Wallet[]
        const stakedBrokers = signers.slice(0, stakedBrokerCount)
        const nonStakedBrokers = signers.slice(stakedBrokerCount, stakedBrokerCount + nonStakedBrokerCount)

        const contracts = await deployTestContracts(admin)

        // TODO: maybe "clean brokers" weren't really necessary? BrokerPoolFactory CREATE2 salt can be freely set now
        const cleanBrokers: Wallet[] = []
        if (cleanBrokerCount > 0) {
            assert(cleanBrokerSeed, "Test-specific cleanBrokerSeed must be provided if cleanBrokerCount > 0, to make sure they're clean")
            for (let i = 0; i < cleanBrokerCount; i++) {
                const key = id(id(cleanBrokerSeed) + i.toString())
                const b = new Wallet(key, admin.provider)
                cleanBrokers.push(b)

                // clean brokers start from nothing => need ether to deploy BrokerPool etc.
                await (await admin.sendTransaction({ to: b.address, value: parseEther("1") })).wait()
            }
        }
        const brokers = [...stakedBrokers, ...nonStakedBrokers, ...cleanBrokers]

        // minting must happen one by one since it's all done from admin account
        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        for (const b of brokers) {
            await (await token.mint(b.address, parseEther("1000"))).wait()
        }

        // no risk of nonce collisions in Promise.all since each broker has their own separate nonce
        const pools = await Promise.all(brokers.map((b) => deployBrokerPool(contracts, b)))
        await Promise.all(brokers.map((b, i) => token.connect(b).transferAndCall(pools[i].address, parseEther("1000"), "0x")))

        const bounty = await deployBountyContract(contracts, {
            allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 1000,
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
            cleanBrokers,
            pools,
        }
    }

    describe("Flagging + voting + resolution (happy path)", (): void => {
        it("with one flagger, one target and 1 voter", async function(): Promise<void> {
            const { token, bounty, brokers: [ broker, _, broker3 ], pools: [ pool1, pool2 ] } = await setup(3)

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
            const { token, bounty, brokers: [ broker, _, broker3, broker4, broker5 ], pools: [ pool1, flaggedPool ] } = await setup(5)

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
            // TODO
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
        it("allows the flagger to wighdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            // TODO
        })

        it("allows the flagger to wighdraw the correct amount AFTER the flag period", async function(): Promise<void> {
            // TODO
        })
    })
})