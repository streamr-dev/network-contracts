import { ethers } from "hardhat"
import { BigNumber, utils, Wallet } from "ethers"
import { expect } from "chai"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { setupBounties, BountyTestSetup } from "../setupBounty"
import { advanceToTimestamp, getBlockTimestamp, VOTE_KICK, VOTE_NO_KICK, VOTE_START, VOTE_END } from "../utils"

const { parseEther, getAddress, hexZeroPad } = utils

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function max(a: BigNumber, b: BigNumber) { return a.gt(b) ? a : b }

describe("VoteKickPolicy", (): void => {

    // default setup for test cases that don't need a clean set of contracts
    // clean setup is needed when review selection has to be controlled (so that BrokerPools from old tests don't interfere)
    let defaultBountySetup: BountyTestSetup
    let contracts: TestContracts
    before(async (): Promise<void> => {
        const signers = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(signers[0])
        for (const { address } of signers) {
            await (await contracts.token.mint(address, parseEther("1000000"))).wait()
        }
        defaultBountySetup = await setupBounties(contracts, [3, 2], "default-setup")
    })

    describe("Flagging + voting + resolution (happy path)", (): void => {
        it("with one flagger, one target and one voter", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            const {
                token,
                bounties: [ bounty ],
                pools: [ flagger, target, voter ]
            } = await setupBounties(contracts, [3], "one-of-each")

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START, `${addr(flagger)} votes to kick ${addr(target)}`)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target.address, parseEther("100"))

            expect(await token.balanceOf(target.address)).to.equal(parseEther("900")) // slash 10%
        })

        it("with 3 voters", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            const {
                token,
                bounties: [ bounty ],
                pools: [ flagger, target, voter1, voter2, voter3 ]
            } = await setupBounties(contracts, [5], "3-voters-test")

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter1, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(voter2, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(voter3, "ReviewRequest").withArgs(bounty.address, target.address)
            await advanceToTimestamp(start + VOTE_START, `votes to kick ${addr(target)}`)
            await expect(voter1.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter2.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter3.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target.address, parseEther("100"))
            expect(await token.balanceOf(target.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(voter1.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voter2.address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(voter3.address)).to.equal(parseEther("1"))
        })

        it("with 2 flags active at the same time (not interfere with each other)", async function(): Promise<void> {
            const {
                token,
                bounties: [ bounty ],
                pools: [ flagger1, flagger2, target1, target2, voter ],
            } = await setupBounties(contracts, [4, 1], "2-active-flags")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(target1)} and ${addr(target2)} are flagged`)
            await expect (flagger1.flag(bounty.address, target1.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target1.address)
                .to.emit(target2, "ReviewRequest").withArgs(bounty.address, target1.address)
                .to.emit(flagger2, "ReviewRequest").withArgs(bounty.address, target1.address)
            await expect (flagger2.flag(bounty.address, target2.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target2.address)
                .to.emit(target1, "ReviewRequest").withArgs(bounty.address, target2.address)
                .to.emit(flagger1, "ReviewRequest").withArgs(bounty.address, target2.address)

            await advanceToTimestamp(start + VOTE_START, `votes to kick ${addr(target1)} and ${addr(target2)}`)
            await expect(flagger2.voteOnFlag(bounty.address, target1.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")
            await expect(flagger1.voteOnFlag(bounty.address, target2.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")
            await expect(voter.voteOnFlag(bounty.address, target1.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")
            await expect(voter.voteOnFlag(bounty.address, target2.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")

            await expect(target2.voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target1.address, parseEther("100"))
            await expect(target1.voteOnFlag(bounty.address, target2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target2.address, parseEther("100"))

            // 100 tokens slashing happens to target1,2 pools
            expect(await token.balanceOf(target1.address)).to.equal(parseEther("901")) // (target +) voter + remaining stake
            expect(await token.balanceOf(target2.address)).to.equal(parseEther("901")) // voter (+ target) + remaining stake
            expect(await token.balanceOf(flagger1.address)).to.equal(parseEther("2"))  // flagger + voter
            expect(await token.balanceOf(flagger2.address)).to.equal(parseEther("2"))  // voter + flagger
            expect(await token.balanceOf(voter.address)).to.equal(parseEther("2"))  // voter + voter
        })
    })

    describe("Reviewer selection", function(): void {
        it("picks first brokers that are not in the same bounty", async () => {
            const {
                bounties: [ bounty ],
                poolsPerBounty: [
                    [ flagger, target ],
                    [ p4, p5, p6, p7 ]
                ]
            } = await setupBounties(contracts, [5, 4], "pick-first-nonstaked-brokers")

            // all 4 brokers that are not in the same bounty get picked; additionally 1 more from same bounty randomly (but not more!)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(p4, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(p5, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(p6, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(p7, "ReviewRequest").withArgs(bounty.address, target.address)
        })

        // live = staked to any Bounty
        it("will only pick live reviewers", async () => {
            const { bounties, pools: [ flagger, target, voter, nonStaked ], poolFactory } = await setupBounties(contracts, [2, 2], "pick-only-live-reviewers")
            console.log("factory", contracts.poolFactory.address)
            await expect(nonStaked.unstake(bounties[1].address))
                .to.emit(poolFactory, "BrokerPoolLivenessChanged").withArgs(nonStaked.address, false)
            await expect(flagger.flag(bounties[0].address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounties[0].address, target.address)
                .to.not.emit(nonStaked, "ReviewRequest")
        })
    })

    describe("Flagging", function(): void {
        it("FAILS if not enough stake", async function(): Promise<void> {
            // TODO: error_notEnoughStake
        })

        it("FAILS for a target that is already flagged", async function(): Promise<void> {
            // TODO:
        })

        it("FAILS for a target that is not in the bounty", async function(): Promise<void> {
            const { bounties: [ bounty ], poolsPerBounty: [ [flagger], [notStakedPool] ] } = await defaultBountySetup
            await expect(flagger.flag(bounty.address, notStakedPool.address))
                .to.be.revertedWith("error_flagTargetNotStaked")
        })
    })

    describe("Flag resolution", function(): void {
        it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
            // TODO
        })

        it("results in NO_KICK if no one voted", async function(): Promise<void> {
            const { bounties: [ bounty ], pools: [ flagger, target ] } = defaultBountySetup
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(bounty.address, target.address)).wait()

            // attempting to vote actually ends the vote because voting period is over
            await advanceToTimestamp(start + VOTE_END + 10, "End vote")
            expect(await bounty.getFlag(target.address)).to.not.equal("0") // open
            await (await target.voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            expect(await bounty.getFlag(target.address)).to.equal("0") // closed

            // target is not kicked
            expect(await bounty.stakedWei(target.address)).to.not.equal("0")
        })

        it("rewards the flagger", async function(): Promise<void> {
            // TODO
        })

        it("prevents immediately flagging the same broker again after NO_KICK result", async function(): Promise<void> {
            // TODO: error_cannotFlagAgain
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger already was kicked", async function(): Promise<void> {
            const {
                token, bounties: [ bounty ],
                poolsPerBounty: [ [flagger, target], voters ]
            } = await setupBounties(contracts, [2, 5], "flagger-had-been-kicked")
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

            expect(await bounty.stakedWei(flagger.address)).to.equal("0") // flagger is kicked

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to not kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[1].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[4].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            expect (await token.balanceOf(voters[0].address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(voters[1].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voters[2].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voters[3].address)).to.equal(parseEther("2"))
            expect (await token.balanceOf(voters[4].address)).to.equal(parseEther("2"))
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger already forceUnstaked", async function(): Promise<void> {
            const {
                token, bounties: [ bounty ],
                poolsPerBounty: [ [flagger, target], voters ]
            } = await setupBounties(contracts, [2, 5], "forceUnstaked-flagger")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(bounty.address, target.address)).wait()

            await advanceToTimestamp(start + 10, `${addr(flagger)} forceUnstakes`)
            const flaggerBalanceBefore = await token.balanceOf(flagger.address)
            await expect(flagger.unstake(bounty.address)).to.be.revertedWith("error_activeFlag")
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

            expect (await token.balanceOf(voters[0].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voters[1].address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(voters[2].address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(voters[3].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voters[4].address)).to.equal(parseEther("1"))

            expect(flaggerBalanceBefore).to.equal("0")
            expect(flaggerBalanceAfter).to.equal(parseEther("990")) // flag-stake was forfeited
        })

        it("pays reviewers who correctly voted KICK even if target already forceUnstaked", async function(): Promise<void> {
            const {
                token, bounties: [ bounty ],
                poolsPerBounty: [ [flagger, target], voters ]
            } = await setupBounties(contracts, [2, 5], "target-forceUnstake")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(bounty.address, target.address)).wait()

            await advanceToTimestamp(start + 10, `${addr(target)} forceUnstakes`)
            const targetBalanceBefore = await token.balanceOf(target.address)
            await expect(target.unstake(bounty.address)).to.be.revertedWith("error_activeFlag")
            await (await target.forceUnstake(bounty.address, "1")).wait()
            const targetBalanceAfter = await token.balanceOf(target.address)

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[4].voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.emit(bounty, "SponsorshipReceived").withArgs(bounty.address, parseEther("96")) // 1 goes to flagger + 3 goes to reviewers

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            expect (await token.balanceOf(voters[0].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voters[1].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voters[2].address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(voters[3].address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(voters[4].address)).to.equal(parseEther("0"))

            expect(targetBalanceBefore).to.equal("0")
            expect(targetBalanceAfter).to.equal(parseEther("900")) // 10% stake was forfeited
        })
    })

    describe("Voting timeline", function(): void {
        it("NO voting before the voting starts", async function(): Promise<void> {
            const { bounties: [ bounty ], pools: [ flagger, target, voter ] } = await setupBounties(contracts, [2, 1], "voting-timeline")
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_votingNotStarted")
        })

        it("voting resolution can be triggered by anyone after the voting period is over", async function(): Promise<void> {
        })
    })

    describe("Committed stake", (): void => {
        it("allows the target to reduce stake the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounties: [ bounty ], pools: [ flagger, target, voter ] } = await setupBounties(contracts, [2, 1], "target-reducestake")

            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            const minimumStake = await bounty.minimumStakeOf(target.address)
            expect(minimumStake).to.equal(parseEther("100"))
            await expect(flagger.unstake(bounty.address)).to.be.rejectedWith("error_activeFlag")
            await expect(target.reduceStakeTo(bounty.address, parseEther("99"))).to.be.revertedWith("error_minimumStake")
            await expect(target.reduceStakeTo(bounty.address, parseEther("100")))
                .to.emit(bounty, "StakeUpdate").withArgs(target.address, parseEther("100"), parseEther("0"))
        })

        it("allows the target to unstake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const { bounties: [ bounty ], pools: [ flagger, target, voter ] } = await setupBounties(contracts, [2, 1], "target-after-flag")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(bounty. address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            await expect(target.unstake(bounty.address))
                .to.emit(bounty, "BrokerLeft").withArgs(target.address, parseEther("1000"))
        })

        it("allows the flagger to reduce stake the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounties: [ bounty ], poolsPerBounty: [ [flagger, ...targets], [voter] ] } = await setupBounties(contracts, [8, 1], "flagger-reducestake")

            await expect(flagger.flag(bounty.address, targets[0].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[1].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[2].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[3].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[4].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[5].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[6].address)).to.emit(voter, "ReviewRequest")

            const minimumStake = await bounty.minimumStakeOf(flagger.address)
            expect(minimumStake).to.equal(parseEther("70"))
            await expect(flagger.unstake(bounty.address)).to.be.rejectedWith("error_activeFlag")
            await expect(flagger.reduceStakeTo(bounty.address, parseEther("69"))).to.be.revertedWith("error_minimumStake")
            await expect(flagger.reduceStakeTo(bounty.address, parseEther("70")))
                .to.emit(bounty, "StakeUpdate").withArgs(flagger.address, parseEther("70"), parseEther("0"))
        })

        it("allows the flagger to unstake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const { bounties: [ bounty ], pools: [ flagger, target, voter ] } = await setupBounties(contracts, [2, 1], "flagger-after-flag")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            await expect(flagger.unstake(bounty.address))
                .to.emit(bounty, "BrokerLeft").withArgs(flagger.address, parseEther("999"))
        })

        it("does NOT allow the flagger to flag if he has not enough uncommitted stake", async function(): Promise<void> {
            const { bounties: [ bounty ], poolsPerBounty: [ [flagger, ...targets], [voter] ] } = await setupBounties(contracts, [8, 1], "super-flagger", {
                stakeAmountWei: parseEther("68"), // flag-stake is 10 tokens
            })
            await expect(flagger.flag(bounty.address, targets[0].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[1].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[2].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[3].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[4].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[5].address)).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(bounty.address, targets[6].address)).to.be.rejectedWith("error_notEnoughStake")
        })

        it("does NOT allow the flagger to flag if his stake has been slashed below minimum stake", async function(): Promise<void> {
            const { bounties: [ bounty ], pools: [ flagger, target, voter ] } = await setupBounties(contracts, [3, 0], "flagger-slashed-below-minimum", {
                stakeAmountWei: parseEther("70"),
                bountySettings: {
                    minimumStakeWei: parseEther("70"),
                }
            })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address)).to.emit(voter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await (await voter.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            expect(await bounty.stakedWei(flagger.address)).to.equal(parseEther("69")) // paid one reviewer's fee

            await advanceToTimestamp(start + VOTE_START + 1000, `${addr(flagger)} tries to flag ${addr(voter)}`)
            await expect(flagger.flag(bounty.address, voter.address)).to.be.rejectedWith("error_notEnoughStake")
        })

        it("ensures enough tokens to pay reviewers if flagger reduces stake to minimum then gets kicked", async function(): Promise<void> {
            // important that 10% of minimumStakeWei is enough to pay reviewers
            // I.e. minimumStakeWei >= 10 * (flaggerRewardWei + flagReviewerCount * flagReviewerRewardWei)

            const reviewerCount = +await contracts.streamrConfig.flagReviewerCount()
            const minimumStakeWei = await contracts.streamrConfig.minimumStakeWei()
            const flagStakeWei = await contracts.streamrConfig.flagStakeWei()
            // const flagReviewerRewardWei = parseEther("1")
            // const flaggerRewardWei = parseEther("1")
            // const totalRewardsWei =  flagReviewerRewardWei.mul(MAX_REVIEWERS).add(flaggerRewardWei)
            // const leftoverWei = flagStakeWei.sub(totalRewardsWei)

            const {
                token,
                bounties: [ bounty ],
                pools: [ flagger, target, ...voters ],
            } = await setupBounties(contracts, [2, reviewerCount], "sufficient-flag-stake", {
                bountySettings: { minimumStakeWei },
                sponsor: false
            })
            const start = await getBlockTimestamp()
            const start2 = start + VOTE_START + 1000

            const minimumStake = await bounty.minimumStakeOf(flagger.address)
            expect(minimumStake).to.equal(minimumStakeWei)
            const flaggerStakeWei = max(minimumStake, flagStakeWei.mul(10).div(9).add(1)) // can't flag unless stake is 10/9 of flagStakeWei
            await expect(flagger.reduceStakeTo(bounty.address, flaggerStakeWei))
                .to.emit(bounty, "StakeUpdate").withArgs(flagger.address, flaggerStakeWei, parseEther("0"))

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voters[0], "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START, `${voters.map(addr).join(", ")} vote NO_KICK`)
            await Promise.all(voters.map(async (voter) => (await voter.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()))

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            await advanceToTimestamp(start2, `${addr(target)} flags ${addr(flagger)}`)
            await expect(target.flag(bounty.address, flagger.address))
                .to.emit(voters[0], "ReviewRequest").withArgs(bounty.address, flagger.address)

            await advanceToTimestamp(start2 + VOTE_START, `Voters vote to KICK ${addr(flagger)}`)
            await Promise.all(voters.map(async (voter) => (await voter.voteOnFlag(bounty.address, flagger.address, VOTE_KICK)).wait()))

            expect(await bounty.stakedWei(flagger.address)).to.equal("0") // flagger is kicked

            await advanceToTimestamp(start2 + VOTE_START + 1000, "Everyone unstakes")
            await expect(target.unstake(bounty.address))
            expect(await bounty.totalStakedWei()).to.equal("0")

            // reviewers got paid for 2 reviews
            voters.forEach(async (voter) => {
                expect (await token.balanceOf(voter.address)).to.equal(parseEther("2"))
            })

            // "counter-flagger" got paid for 1
            expect (await token.balanceOf(target.address)).to.equal(parseEther("1001"))
        })

        it("ensures enough tokens to pay reviewers if flagger gets maximally slashed then kicked", async function(): Promise<void> {
            // important that flagStakeWei is at least 10/9 of possible total reviewer rewards
            // because (flagStakeWei - reviewer rewards) * (number of flags) will be left to the flagger after maximal slashing
            const { bounties: [ bounty ], pools: [ flagger, ...targets ] } = await setupBounties(contracts, [7], "extreme-flagger", {
                stakeAmountWei: parseEther("67"), // flag-stake is 10 tokens
            })
            const start = await getBlockTimestamp()
            const start2 = start + VOTE_END + 1000

            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            await (await flagger.flag(bounty.address, targets[0].address)).wait()
            await (await flagger.flag(bounty.address, targets[1].address)).wait()
            await (await flagger.flag(bounty.address, targets[2].address)).wait()
            await (await flagger.flag(bounty.address, targets[3].address)).wait() // only picks 4 reviewers, boohoo
            await (await flagger.flag(bounty.address, targets[4].address)).wait()
            await (await flagger.flag(bounty.address, targets[5].address)).wait()

            await advanceToTimestamp(start + VOTE_START, "Targets vote NO_KICK")
            // const voters = targets.map((t) => targets.filter((t2) => t2.address !== t.address))
            for (const target of targets) {
                await Promise.all(targets.map(async (voter) => {
                    const tx = await (voter.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).catch(() => null)
                    if (tx) { return tx.wait() }
                }))
            }

            // 67(original) - 6(flags) * 5(reviewers) + 1 (where we didn't manage to pick a full reviewer set)
            expect(await bounty.stakedWei(flagger.address)).to.equal(parseEther("38"))

            await advanceToTimestamp(start2, `${addr(targets[0])} flags ${addr(flagger)}`)
            await expect(targets[0].flag(bounty.address, flagger.address))
                .to.emit(targets[1], "ReviewRequest").withArgs(bounty.address, flagger.address)

            await advanceToTimestamp(start2 + VOTE_START, `Voters vote to KICK ${addr(flagger)}`)
            await Promise.all(targets.slice(1).map(async (voter) => voter.voteOnFlag(bounty.address, flagger.address, VOTE_KICK)))

            expect(await bounty.stakedWei(flagger.address)).to.equal("0") // flagger is kicked
        })
    })
})
