import { ethers } from "hardhat"
import { BigNumber, utils, Wallet } from "ethers"
import { expect } from "chai"

import { deployTestContracts } from "../deployTestContracts"
import { deployBountyContract } from "../deployBountyContract"
import { deployBrokerPool } from "../deployBrokerPool"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"

const { parseEther, id, getAddress, hexZeroPad } = utils

const VOTE_KICK = "0x0000000000000000000000000000000000000000000000000000000000000001"
const VOTE_NO_KICK = "0x0000000000000000000000000000000000000000000000000000000000000000"
const VOTE_START = 24 * 60 * 60 // 1 day

function parseFlag(flagData: BigNumber) {
    return {
        flagger: getAddress(hexZeroPad(flagData.shr(96).mask(160).toHexString(), 20)),
        startDate: new Date(flagData.shr(64).mask(32).toNumber() * 1000),
        reviewerCount: flagData.shr(48).mask(16).toNumber(),
        votesForKick: flagData.shr(32).mask(16).toNumber(),
        votesAgainstKick: flagData.shr(16).mask(16).toNumber(),
    }
}

// pretty-print address
function addr(w: {address: string}) {
    return w.address?.slice(0, 5) + "…" + w.address?.slice(-3)
}

describe("VoteKickPolicy", (): void => {

    // default setup for test cases that don't need a clean set of contracts
    // clean setup is needed when review selection has to be controlled (so that BrokerPools from old tests don't interfere)
    let defaultSetup: any
    before(async (): Promise<void> => {
        defaultSetup = await setup(3, 2)
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
        it("with one flagger, one target and one voter", async function(): Promise<void> {
            const { token, bounty, pools: [ flagger, target, reviewer ] } = await setup(3, 0, this.test?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address)).to.emit(bounty, "ReviewRequest")
                .withArgs(reviewer.address, bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START + 10, `${addr(flagger)} votes to kick ${addr(target)}`)
            await expect(reviewer.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target.address, parseEther("100"))
            expect(await token.balanceOf(target.address)).to.equal(parseEther("900"))
        })

        it("with 3 voters", async function(): Promise<void> {
            const { token, bounty, brokers: [ , , broker3, broker4, broker5 ],
                pools: [ flagger, target, voter1, voter2, voter3 ] } = await setup(5, 0, this.test?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter1.address, bounty.address, target.address)
                .to.emit(bounty, "ReviewRequest").withArgs(voter2.address, bounty.address, target.address)
                .to.emit(bounty, "ReviewRequest").withArgs(voter3.address, bounty.address, target.address)
            await advanceToTimestamp(start + VOTE_START + 10, `votes to kick ${addr(target)}`)
            await expect(voter1.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter2.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter3.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target.address, parseEther("100"))
            expect(await token.balanceOf(target.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(broker3.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(broker4.address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(broker5.address)).to.equal(parseEther("1"))
        })

        it("with 2 flags active at the same time (not interfere with each other)", async function(): Promise<void> {
            const { token, bounty, brokers, pools: [ flagger1, flagger2, target1, target2, voter ],
                nonStakedBrokers: [voterBroker] } = await setup(4, 1, "2-simultaneous-active-flags")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(target1)} and ${addr(target2)} are flagged`)
            await expect (flagger1.flag(bounty.address, target1.address))
                .to.emit(bounty, "ReviewRequest").withArgs(flagger2.address, bounty.address, target1.address)
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, target1.address)
                .to.emit(bounty, "ReviewRequest").withArgs(target2.address, bounty.address, target1.address)
            await expect (flagger2.flag(bounty.address, target2.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, target2.address)
                .to.emit(bounty, "ReviewRequest").withArgs(flagger1.address, bounty.address, target2.address)
                .to.emit(bounty, "ReviewRequest").withArgs(target1.address, bounty.address, target2.address)

            await advanceToTimestamp(start + VOTE_START + 10, `votes to kick ${addr(target1)} and ${addr(target2)}`)
            await expect(flagger2.voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(flagger1.voteOnFlag(bounty.address, target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter.voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter.voteOnFlag(bounty.address, target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(target2.voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target1.address, parseEther("100"))
            await expect(target1.voteOnFlag(bounty.address, target2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target2.address, parseEther("100"))

            // slashing happens to pools
            expect(await token.balanceOf(target1.address)).to.equal(parseEther("900"))
            expect(await token.balanceOf(target2.address)).to.equal(parseEther("900"))

            // rewards go to brokers
            expect (await token.balanceOf(brokers[0].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(brokers[1].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(brokers[2].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(brokers[3].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voterBroker.address)).to.equal(parseEther("2"))
        })
    })

    describe("Flagging + reviewer selection", function(): void {
        it("picks first brokers that are not in the same bounty", async () => {
            const { bounty, pools: [ pool1, flaggedPool,,, p4, p5, p6, p7] } = await setup(4, 4, "pick-first-nonstaked-brokers")

            // all 4 brokers that are not in the same bounty get picked; additionally 1 more from same bounty randomly
            await expect (pool1.flag(bounty.address, flaggedPool.address))
                .to.emit(bounty, "ReviewRequest").withArgs(p4.address, bounty.address, flaggedPool.address)
                .to.emit(bounty, "ReviewRequest").withArgs(p5.address, bounty.address, flaggedPool.address)
                .to.emit(bounty, "ReviewRequest").withArgs(p6.address, bounty.address, flaggedPool.address)
                .to.emit(bounty, "ReviewRequest").withArgs(p7.address, bounty.address, flaggedPool.address)
        })

        it("can NOT flag if not enough stake", async function(): Promise<void> {
            // TODO: error_notEnoughStake
        })

        it("can NOT flag a broker that is already flagged", async function(): Promise<void> {
            // TODO:
        })

        it("does NOT allow to flag a broker that is not in the bounty", async function(): Promise<void> {
            const { bounty, pools: [ flagger,,, notStakedPool ] } = await defaultSetup
            await expect(flagger.flag(bounty.address, notStakedPool.address))
                .to.be.revertedWith("error_flagTargetNotStaked")
        })
    })

    describe("Flag resolution", function(): void {
        it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
            // TODO
        })

        it("results in NO_KICK if no one voted", async function(): Promise<void> {
            // TODO
        })

        it("prevents immediately flagging the same broker again after NO_KICK result", async function(): Promise<void> {
            // TODO: error_cannotFlagAgain
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger was kicked", async function(): Promise<void> {
            const { token, bounty, brokers: [ , , ...voterBrokers ], pools: [ flagger, target, ...voters ] } = await setup(2, 5, "kicked-flagger")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(bounty.address, target.address)).wait()

            await advanceToTimestamp(start + 10, `${addr(target)} flags ${addr(flagger)}`)
            await (await target.flag(bounty.address, flagger.address)).wait()

            await advanceToTimestamp(start + VOTE_START + 20, `Voting to kick ${addr(flagger)}`)
            await (await voters[0].voteOnFlag(bounty.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(bounty.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(bounty.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(bounty.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[4].voteOnFlag(bounty.address, flagger.address, VOTE_KICK)).wait()

            expect(await bounty.getStake(flagger.address)).to.equal("0") // flagger is kicked

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to not kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[1].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[4].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            expect (await token.balanceOf(voterBrokers[0].address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(voterBrokers[1].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voterBrokers[2].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voterBrokers[3].address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(voterBrokers[4].address)).to.equal(parseEther("2"))
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger forceUnstaked", async function(): Promise<void> {
            const { token, bounty, brokers: [ , , ...voterBrokers ], pools: [ flagger, target, ...voters ] } = await setup(2, 5, "flgr-forceunstake")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(bounty.address, target.address)).wait()

            await advanceToTimestamp(start + 10, `${addr(flagger)} forceUnstakes`)
            const flaggerBalanceBefore = await token.balanceOf(flagger.address)
            await expect(flagger.unstake(bounty.address, "1")).to.be.revertedWith("error_activeFlag")
            await (await flagger.forceUnstake(bounty.address, "1")).wait()
            const flaggerBalanceAfter = await token.balanceOf(flagger.address)

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to not kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[1].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[4].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.emit(bounty, "SponsorshipReceived").withArgs(bounty.address, parseEther("7")) // 3 goes to reviewers

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            expect (await token.balanceOf(voterBrokers[0].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voterBrokers[1].address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(voterBrokers[2].address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(voterBrokers[3].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voterBrokers[4].address)).to.equal(parseEther("1"))

            expect(flaggerBalanceBefore).to.equal("0")
            expect(flaggerBalanceAfter).to.equal(parseEther("990")) // flag-stake was forfeited
        })
    })

    describe("Canceling a flag", function(): void {
        it("works (happy path)", async function(): Promise<void> {
            // cancel after some voter has voted (not all), pay the ones who voted
            // broker flags broker2, broker3 votes, broker4 doesn't vote, broker cancels => all get paid nevertheless
            const { token, bounty, brokers: [ , , voter, nonVoter ], pools: [ flagger, target ] } = await setup(4)

            await (await flagger.flag(bounty.address, target.address)).wait()
            expect(parseFlag(await bounty.getFlag(target.address))).to.include({
                flagger: flagger.address,
                reviewerCount: 2,
                votesForKick: 0,
                votesAgainstKick: 0,
            })
            await(await flagger.cancelFlag(bounty.address, target.address)).wait()
            expect(await bounty.getFlag(target.address)).to.equal("0")

            expect (await token.balanceOf(voter.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(nonVoter.address)).to.equal(parseEther("1"))
        })

        it("can be called by anyone if the flagger was kicked (and pays everyone correctly)", async function(): Promise<void> {

        })
    })

    describe("Voting timeline", function(): void {
        it("NO voting before the voting starts", async function(): Promise<void> {
            const { bounty, pools: [ flagger, target, voter ] } = await setup(2, 1)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, target.address)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_votingNotStarted")
        })

        it("voting resolution can be triggered by anyone after the voting period is over", async function(): Promise<void> {
        })
    })

    describe("Committed stake", (): void => {
        it("allows the target to get out the correct amount of stake DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, pools: [ flagger, target, voter ] } = await setup(2, 1, this.currentTest?.title)

            await (await target.reduceStakeTo(bounty.address, parseEther("900"))).wait() // get a nicer rounder number... 10/9 of 90 is 100

            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, target.address)

            const minimumStake = await bounty.minimumStakeOf(target.address)
            expect(minimumStake).to.equal(parseEther("100"))
            await expect(target.reduceStakeTo(bounty.address, parseEther("99")))
                .to.be.revertedWith("error_cannotReduceStake")
            await expect(target.reduceStakeTo(bounty.address, parseEther("100")))
                .to.emit(bounty, "StakeUpdate").withArgs(target.address, parseEther("100"), parseEther("0"))
        })

        it("allows the target to withdraw the correct amount AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const { bounty, pools: [ flagger, target, voter ] } = await setup(2, 1, this.currentTest?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START + 10, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(bounty. address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            await expect(target.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(target.address, parseEther("1000"))
        })

        it("allows the flagger to withdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, pools: [ flagger, target, voter] } = await setup(2, 1, this.currentTest?.title)

            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, target.address)

            const minimumStake = await bounty.minimumStakeOf(flagger.address)
            expect(minimumStake).to.equal("11111111111111111111") // 10/9 of 100
            await expect(flagger.reduceStakeTo(bounty.address, parseEther("11")))
                .to.be.revertedWith("error_cannotReduceStake")
            await expect(flagger.reduceStakeTo(bounty.address, "11111111111111111111"))
                .to.emit(bounty, "StakeUpdate").withArgs(flagger.address, "11111111111111111111", parseEther("0"))
        })

        it("allows the flagger to withdraw all their stake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const { bounty, pools: [ flagger, target, voter] } = await setup(2, 1, this.currentTest?.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voter.address, bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START + 10, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            await expect(flagger.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(flagger.address, parseEther("999"))
        })

        it("does NOT allow the flagger to flag if he has not enough uncommitted stake", async function(): Promise<void> {
            // TODO
        })
    })
})
