import { ethers } from "hardhat"
import { BigNumber, utils, Wallet, ContractReceipt } from "ethers"
import { expect } from "chai"

import { deployTestContracts } from "../deployTestContracts"
import { deployBountyContract } from "../deployBountyContract"
import { deployBrokerPool } from "../deployBrokerPool"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"

const { parseEther, id, getAddress, hexZeroPad } = utils

const VOTE_KICK = "0x0000000000000000000000000000000000000000000000000000000000000001"
const VOTE_CANCEL = "0x0000000000000000000000000000000000000000000000000000000000000000"
const DAYS = 24 * 60 * 60

function parseFlag(flagData: BigNumber) {
    return {
        flagger: getAddress(hexZeroPad(flagData.shr(96).mask(160).toHexString(), 20)),
        startDate: new Date(flagData.shr(64).mask(32).toNumber() * 1000),
        reviewerCount: flagData.shr(48).mask(16).toNumber(),
        votesForKick: flagData.shr(32).mask(16).toNumber(),
        votesAgainstKick: flagData.shr(16).mask(16).toNumber(),
    }
}

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
    async function setup(stakedBrokerCount = 3, nonStakedBrokerCount = 0, saltSeed?: string, bountySettings: any = {}) {
        // Hardhat provides 20 pre-funded signers
        const [admin, ...signers] = await ethers.getSigners() as unknown as Wallet[]
        const stakedBrokers = signers.slice(0, stakedBrokerCount)
        const nonStakedBrokers = signers.slice(stakedBrokerCount, stakedBrokerCount + nonStakedBrokerCount)
        const brokers = [...stakedBrokers, ...nonStakedBrokers]

        // clean deployer wallet starts from nothing => needs ether to deploy BrokerPool etc.
        const deployer = !saltSeed ? admin : new Wallet(id(saltSeed), admin.provider) // id turns string into bytes32
        if (saltSeed) {
            await (await admin.sendTransaction({ to: deployer.address, value: parseEther("1") })).wait()
        }

        // TODO: split deployTestContracts
        // TODO: what we REALLY want to re-deploy is the BrokerPoolFactory (not all the policies or BountyFactory)
        const contracts = await deployTestContracts(deployer)

        // minting must happen one by one since it's all done from admin account
        const { token } = contracts
        await (await token.mint(deployer.address, parseEther("1000000"))).wait()
        for (const b of brokers) {
            await (await token.mint(b.address, parseEther("1000"))).wait()
        }

        // no risk of nonce collisions in Promise.all since each broker has their own separate nonce
        // see BrokerPoolFactory:_deployBrokerPool for how saltSeed is used in CREATE2
        const pools = await Promise.all(brokers.map((b) => deployBrokerPool(contracts, b, {}, saltSeed)))
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
            bounty,
            brokers,
            stakedBrokers,
            nonStakedBrokers,
            pools,
        }
    }

    describe("Flagging + voting + resolution (happy path)", (): void => {
        it("with one flagger, one target and 1 voter", async function(): Promise<void> {
            const { token, bounty, brokers: [ broker, _, broker3 ], pools: [ pool1, pool2 ] } = await setup(3, 0, this.test?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${broker.address} flags ${pool2.address}`)
            const flagReceipt = await (await bounty.connect(broker).flag(pool2.address, pool1.address)).wait() as ContractReceipt
            expect(flagReceipt.events!.filter((e) => e.event === "ReviewRequest")).to.have.length(1)
            const reviewRequest = flagReceipt.events!.find((e) => e.event === "ReviewRequest")
            expect(reviewRequest?.args?.bounty).to.equal(bounty.address)
            expect(reviewRequest?.args?.target).to.equal(pool2.address)
            expect(reviewRequest?.args?.reviewer).to.equal(broker3.address)

            await advanceToTimestamp(start + 1*DAYS + 10, `${broker3} votes to kick ${pool2.address}`)
            await expect(bounty.connect(broker3).voteOnFlag(pool2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(pool2.address, parseEther("100"))
            expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))
        })

        it("with 3 voters", async function(): Promise<void> {
            const { token, bounty, brokers: [ broker, _, broker3, broker4, broker5 ],
                pools: [ pool1, flaggedPool ] } = await setup(5, 0, this.test?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${broker.address} flags ${flaggedPool.address}`)
            const flagReceipt = await (await bounty.connect(broker).flag(flaggedPool.address, pool1.address)).wait() as ContractReceipt
            const reviewRequests = flagReceipt.events!.filter((e) => e.event === "ReviewRequest")
            expect(reviewRequests.length).to.equal(3)
            reviewRequests.forEach((reviewRequest) => {
                expect(reviewRequest.args?.bounty).to.equal(bounty.address)
                expect(reviewRequest.args?.target).to.equal(flaggedPool.address)
                expect([broker3.address, broker4.address, broker5.address]).to.include(reviewRequest.args?.reviewer)
            })

            await advanceToTimestamp(start + 1*DAYS + 10, `votes to kick ${flaggedPool.address}`)
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
                nonStakedBrokers: [voter] } = await setup(4, 1, "2-simultaneous-active-flags")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${target1.address} and ${target2.address} are flagged`)
            const flagReceipt1 = await (await bounty.connect(flagger1).flag(target1.address, pool1.address)).wait() as ContractReceipt
            const reviewRequests1 = flagReceipt1.events!.filter((e) => e.event === "ReviewRequest")
            const reviewers = reviewRequests1.map((e) => e.args?.reviewer)
            expect(reviewers).to.have.members([voter.address, flagger2.address, broker4.address])

            reviewRequests1.forEach((reviewRequest) => {
                expect(reviewRequest.args?.bounty).to.equal(bounty.address)
                expect(reviewRequest.args?.target).to.equal(target1.address)
                expect([voter.address, flagger2.address, broker4.address])
                    .to.include(reviewRequest.args?.reviewer)
            })
            const flagReceipt2 = await (await bounty.connect(flagger2).flag(target2.address, pool2.address)).wait() as ContractReceipt
            const reviewRequests2 = flagReceipt2.events!.filter((e) => e.event === "ReviewRequest")
            const reviewers2 = reviewRequests2.map((e) => e.args?.reviewer)
            expect(reviewers2).to.have.members([voter.address, flagger1.address, broker3.address])

            await advanceToTimestamp(start + 1*DAYS + 10, `votes to kick ${target1.address} and ${target2.address}`)
            await expect(bounty.connect(voter).voteOnFlag(target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(flagger2).voteOnFlag(target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(broker4).voteOnFlag(target1.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target1.address, parseEther("100"))

            await expect(bounty.connect(voter).voteOnFlag(target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(flagger1).voteOnFlag(target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(bounty.connect(broker3).voteOnFlag(target2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target2.address, parseEther("100"))

            // slashing happens to pools
            expect(await token.balanceOf(target1.address)).to.equal(parseEther("900"))
            expect(await token.balanceOf(target2.address)).to.equal(parseEther("900"))

            // rewards go to brokers
            expect (await token.balanceOf(flagger1.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(flagger2.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(broker3.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(broker4.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voter.address)).to.equal(parseEther("2"))
        })
    })

    describe("Flagging + reviewer selection", function(): void {
        it("picks first brokers that are not in the same bounty", async () => {
            const { bounty, brokers, pools: [ pool1, flaggedPool ] } = await setup(4, 4, "pick-first-nonstaked-brokers")
            const flagReceipt = await (await bounty.connect(brokers[0]).flag(flaggedPool.address, pool1.address)).wait() as ContractReceipt
            const reviewers = flagReceipt.events!.filter((e) => e.event === "ReviewRequest").map((e) => e.args?.reviewer)
            // console.log("Brokers %o", brokers.map((b) => b.address))
            // console.log("Flagged pool %o", flaggedPool.address)
            // console.log("Reviewers %o", reviewers)
            expect(reviewers.slice(0, 4)).to.have.members([brokers[4].address, brokers[5].address, brokers[6].address, brokers[7].address])
        })

        it("can NOT flag if not enough stake", async function(): Promise<void> {
            // TODO: error_notEnoughStake
        })

        it("can NOT flag a broker that is already flagged", async function(): Promise<void> {
            // TODO:
        })

        it("does NOT allow to flag a broker that is not in the bounty", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], pools: [ flaggerPool,,, notStakedPool ] } = await defaultSetup
            await expect(bounty.connect(flagger).flag(notStakedPool.address, flaggerPool.address))
                .to.be.revertedWith("error_flagTargetNotStaked")
        })
    })

    describe("Flag resolution", function(): void {
        it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
            // TODO
        })

        it("results in 'no kick' if no one voted", async function(): Promise<void> {
            // TODO
        })

        it("prevents immediately flagging the same broker again", async function(): Promise<void> {
            // TODO: error_cannotFlagAgain
        })
    })

    describe("Canceling a flag", function(): void {
        it("works (happy path)", async function(): Promise<void> {
            // cancel after some voter has voted (not all), pay the ones who voted
            // broker flags broker2, broker3 votes, broker4 doesn't vote, broker cancels => all get paid nevertheless
            const { token, bounty, brokers: [ flagger, _, voter, nonVoter ], pools: [ flaggerPool, flagTarget ] } = await setup(4)

            await (await bounty.connect(flagger).flag(flagTarget.address, flaggerPool.address)).wait()
            expect(parseFlag(await bounty.getFlag(flagTarget.address))).to.include({
                flagger: flaggerPool.address,
                reviewerCount: 2,
                votesForKick: 0,
                votesAgainstKick: 0,
            })
            await (await bounty.connect(flagger).cancelFlag(flagTarget.address, flaggerPool.address)).wait()
            expect(await bounty.getFlag(flagTarget.address)).to.equal("0")

            expect (await token.balanceOf(voter.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(nonVoter.address)).to.equal(parseEther("1"))
        })
    })

    describe("Voting timeline", function(): void {
        it("NO voting before the voting starts", async function(): Promise<void> {
            const { bounty, brokers: [ flagger,, voter ], pools: [ flaggerPool, targetPool ] } = await setup(2, 1)
            await expect(bounty.connect(flagger).flag(targetPool.address, flaggerPool.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, targetPool.address)
            await expect(bounty.connect(voter).voteOnFlag(targetPool.address, VOTE_KICK))
                .to.be.revertedWith("error_votingNotStarted")
        })

        it("voting resolution can be triggered by anyone after the voting period is over", async function(): Promise<void> {
        })
    })

    describe("Committed stake", (): void => {
        it.skip("allows the target to get out the correct amount of stake DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ],
                pools: [ flaggerPool, targetPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, this.currentTest?.title)

            const flagReceipt1 = await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt
            const reviewRequest = flagReceipt1.events!.find((e) => e.event === "ReviewRequest")
            // expect(reviewRequests.length).to.equal(1)
            expect(reviewRequest?.args?.reviewer).to.equal(voter1.address)

            const maxStakeReduction = await bounty.maxStakeReduction(bounty.address)
            expect(maxStakeReduction).to.equal(parseEther("888"))
            await expect(targetPool.reduceStake(bounty.address, parseEther("889")))
                .to.be.revertedWith("error_cannotReduceStake")
            await expect(targetPool.reduceStake(bounty.address, parseEther("888")))
                .to.emit(bounty, "StakeUpdate").withArgs(targetPool.address, parseEther("112"), parseEther("0"))
        })

        it("allows the target to withdraw the correct amount AFTER the flag resolves to 'no kick'", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ],
                pools: [ flaggerPool, targetPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, this.currentTest?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${flagger.address} flags ${targetPool.address}`)
            const flagReceipt1 = await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt
            const reviewRequest = flagReceipt1.events!.find((e) => e.event === "ReviewRequest")
            // expect(reviewRequests.length).to.equal(1)
            expect(reviewRequest?.args?.reviewer).to.equal(voter1.address)

            await advanceToTimestamp(start + 1*DAYS + 10, `${voter1} votes`)
            await expect(bounty.connect(voter1).voteOnFlag(targetPool.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")

            expect(await bounty.getFlag(targetPool.address)).to.equal("0")

            await expect(targetPool.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(targetPool.address, parseEther("1000"))
        })

        it.skip("allows the flagger to withdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], pools: [ flaggerPool, targetPool] } = await setup(2, 1, this.currentTest?.title)

            await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt

            const maxStakeReduction = await bounty.maxStakeReduction(bounty.address)
            expect(maxStakeReduction).to.equal(parseEther("988"))
            await expect(flaggerPool.reduceStake(bounty.address, parseEther("989")))
                .to.be.revertedWith("error_cannotReduceStake")
            await expect(flaggerPool.reduceStake(bounty.address, parseEther("988")))
                .to.emit(bounty, "StakeUpdate").withArgs(flaggerPool.address, parseEther("12"), parseEther("0"))
        })

        it("allows the flagger to withdraw all their stake AFTER the flag resolves to 'no kick'", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ],
                pools: [ flaggerPool, targetPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, this.currentTest?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${flagger.address} flags ${targetPool.address}`)
            const flagReceipt1 = await (await bounty.connect(flagger).flag(targetPool.address, flaggerPool.address)).wait() as ContractReceipt
            const reviewRequest = flagReceipt1.events!.find((e) => e.event === "ReviewRequest")
            // expect(reviewRequests.length).to.equal(1)
            expect(reviewRequest?.args?.reviewer).to.equal(voter1.address)

            await advanceToTimestamp(start + 1*DAYS + 10, `${voter1} votes`)
            await expect(bounty.connect(voter1).voteOnFlag(targetPool.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")

            await expect(flaggerPool.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(flaggerPool.address, parseEther("999"))
        })

    })
})
