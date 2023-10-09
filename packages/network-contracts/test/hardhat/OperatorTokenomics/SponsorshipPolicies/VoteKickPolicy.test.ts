import { ethers } from "hardhat"
import { expect } from "chai"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { setupSponsorships, SponsorshipTestSetup } from "../setupSponsorships"
import { advanceToTimestamp, getBlockTimestamp, VOTE_KICK, VOTE_NO_KICK, VOTE_START, VOTE_END, END_PROTECTION } from "../utils"

import type { MockRandomOracle } from "../../../../typechain"
import type { BigNumber, Wallet } from "ethers"

const { parseEther, formatEther, getAddress, hexZeroPad } = ethers.utils

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

enum FlagState {
    VOTING = 1,
    RESULT_KICK = 2,
    RESULT_NO_KICK = 3,
}

// pretty-print address
function addr(w: {address: string}) {
    return w.address?.slice(0, 5) + "…" + w.address?.slice(-3)
}

function max(a: BigNumber, b: BigNumber) { return a.gt(b) ? a : b }

describe("VoteKickPolicy", (): void => {
    let admin: Wallet

    let mockRandomOracle: MockRandomOracle
    let contracts: TestContracts

    // default setup for test cases that don't need a clean set of contracts
    // clean setup is needed when review selection has to be controlled (so that Operators from old tests don't interfere)
    let defaultSetup: SponsorshipTestSetup
    let signers: Wallet[]

    before(async (): Promise<void> => {
        signers = await ethers.getSigners()
        admin = signers[0]
        contracts = await deployTestContracts(admin)
        for (const { address } of signers) {
            await (await contracts.token.mint(address, parseEther("1000000"))).wait()
        }

        const { streamrConfig } = contracts // TODO: remove and fix before all & 10 broken tests
        await( await streamrConfig.setFlagReviewerRewardWei(parseEther("1"))).wait()
        await( await streamrConfig.setFlaggerRewardWei(parseEther("1"))).wait()
        await( await streamrConfig.setFlagStakeWei(parseEther("10"))).wait()

        defaultSetup = await setupSponsorships(contracts, [3, 2], "default-setup")
        mockRandomOracle = await (await ethers.getContractFactory("MockRandomOracle", { signer: admin })).deploy()
        await (await contracts.streamrConfig.setRandomOracle(mockRandomOracle.address)).wait()
    })

    beforeEach(async () => {
        // For 3 operators, produces 1 2 2 2 2 1 1 0 0 2 2 1 1 0 0 2 2 1 1 0
        // For 5 operators, produces 4 2 2 4 4 3 3 2 2 1 1 0 0 4 4 3 3 2 2 1
        // For 7 operators, produces 6 1 2 5 3 4
        // For 9 operators, produces 4 5 8 8 2 7 4 3 3 5 8 4 1 0 0 2 5 1 7 6
        await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()
    })

    describe("Happy path (flag + vote + resolution)", (): void => {
        it("with one flagger, one target and one voter", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            const {
                token,
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [3], "one-of-each")

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, "{}"))
                .to.emit(sponsorship, "Flagged").withArgs(target.address, flagger.address, parseEther("100"), 1, "{}")
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "{}")

            await advanceToTimestamp(start + VOTE_START, `${addr(flagger)} votes to kick ${addr(target)}`)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.RESULT_KICK, 1, 0)
                .to.emit(sponsorship, "OperatorKicked").withArgs(target.address)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(target.address, parseEther("100"))

            expect(formatEther(await token.balanceOf(target.address))).to.equal("900.0") // slash the slashingFraction
        })

        it("with 3 voters", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            const {
                token,
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter1, voter2, voter3 ]
            } = await setupSponsorships(contracts, [5], "3-voters-test")

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(sponsorship, "Flagged").withArgs(target.address, flagger.address, parseEther("100"), 3, "")
                .to.emit(voter1, "ReviewRequest").withArgs(sponsorship.address, target.address, "")
                .to.emit(voter2, "ReviewRequest").withArgs(sponsorship.address, target.address, "")
                .to.emit(voter3, "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            await advanceToTimestamp(start + VOTE_START, `votes to kick ${addr(target)}`)
            await expect(voter1.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.VOTING, 1, 0)
            await expect(voter2.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.VOTING, 1, 2)
            await expect(voter3.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.RESULT_KICK, 3, 2)
                .to.emit(sponsorship, "OperatorKicked").withArgs(target.address)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(target.address, parseEther("100"))
            expect(formatEther(await token.balanceOf(target.address))).to.equal("900.0")

            expect(formatEther(await token.balanceOf(voter1.address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voter2.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voter3.address))).to.equal("1.0")
        })

        it("with 2 flags active at the same time (not interfere with each other)", async function(): Promise<void> {
            const {
                token,
                sponsorships: [ sponsorship ],
                operators: [ flagger1, flagger2, target1, target2, voter ],
            } = await setupSponsorships(contracts, [4, 1], "2-active-flags")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(target1)} and ${addr(target2)} are flagged`)
            await expect (flagger1.flag(sponsorship.address, target1.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target1.address, "")
                .to.emit(target2, "ReviewRequest").withArgs(sponsorship.address, target1.address, "")
                .to.emit(flagger2, "ReviewRequest").withArgs(sponsorship.address, target1.address, "")
            await expect (flagger2.flag(sponsorship.address, target2.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target2.address, "")
                .to.emit(target1, "ReviewRequest").withArgs(sponsorship.address, target2.address, "")
                .to.emit(flagger1, "ReviewRequest").withArgs(sponsorship.address, target2.address, "")

            await advanceToTimestamp(start + VOTE_START, `votes to kick ${addr(target1)} and ${addr(target2)}`)
            await expect(flagger2.voteOnFlag(sponsorship.address, target1.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target1.address, FlagState.VOTING, 1, 0)
            await expect(flagger1.voteOnFlag(sponsorship.address, target2.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target2.address, FlagState.VOTING, 1, 0)
            await expect(target2.voteOnFlag(sponsorship.address, target1.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target1.address, FlagState.VOTING, 3, 0)
            await expect(target1.voteOnFlag(sponsorship.address, target2.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target2.address, FlagState.VOTING, 3, 0)

            await expect(voter.voteOnFlag(sponsorship.address, target1.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target1.address, FlagState.RESULT_KICK, 5, 0)
                .to.emit(sponsorship, "OperatorKicked").withArgs(target1.address)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(target1.address, parseEther("100"))
            await expect(voter.voteOnFlag(sponsorship.address, target2.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target2.address, FlagState.RESULT_KICK, 5, 0)
                .to.emit(sponsorship, "OperatorKicked").withArgs(target2.address)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(target2.address, parseEther("100"))

            // 100 tokens slashing happens to target1 and target2
            expect(formatEther(await token.balanceOf(target1.address))).to.equal("901.0") // (target +) voter + remaining stake
            expect(formatEther(await token.balanceOf(target2.address))).to.equal("901.0") // voter (+ target) + remaining stake
            expect(formatEther(await token.balanceOf(flagger1.address))).to.equal("2.0")  // flagger + voter
            expect(formatEther(await token.balanceOf(flagger2.address))).to.equal("2.0")  // voter + flagger
            expect(formatEther(await token.balanceOf(voter.address))).to.equal("2.0")  // voter + voter
        })
    })

    describe("Reviewer selection", function(): void {
        it("picks first operators that are not in the same sponsorship", async () => {
            const {
                sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [
                    [ flagger, target ],
                    [ p4, p5, p6, p7 ]
                ]
            } = await setupSponsorships(contracts, [5, 4], "pick-first-nonstaked-operators")

            // all 4 operators that are not in the same sponsorship get picked; additionally 1 more from same sponsorship randomly (but not more!)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(p4, "ReviewRequest").withArgs(sponsorship.address, target.address, "")
                .to.emit(p5, "ReviewRequest").withArgs(sponsorship.address, target.address, "")
                .to.emit(p6, "ReviewRequest").withArgs(sponsorship.address, target.address, "")
                .to.emit(p7, "ReviewRequest").withArgs(sponsorship.address, target.address, "")
        })

        // live = staked to any Sponsorship
        it("will only pick live reviewers", async () => {
            const { operatorFactory, sponsorships, operators: [
                flagger, target, voter, nonStaked
            ] } = await setupSponsorships(contracts, [2, 2], "pick-only-live-reviewers")

            await expect(nonStaked.unstake(sponsorships[1].address))
                .to.emit(operatorFactory, "OperatorLivenessChanged").withArgs(nonStaked.address, false)
            await expect(flagger.flag(sponsorships[0].address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorships[0].address, target.address, "")
                .to.not.emit(nonStaked, "ReviewRequest")
        })
    })

    describe("Flagging", function(): void {
        it("FAILS for a target that is already flagged", async function(): Promise<void> {
            const { sponsorships: [ sponsorship ], operatorsPerSponsorship: [ [flagger, target] ] } = await defaultSetup
            await (await flagger.flag(sponsorship.address, target.address, "")).wait()
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.be.revertedWith("error_cannotFlagAgain")
        })

        it("FAILS for a target that is not in the sponsorship", async function(): Promise<void> {
            const { sponsorships: [ sponsorship ], operatorsPerSponsorship: [ [flagger], [notStaked] ] } = await defaultSetup
            await expect(flagger.flag(sponsorship.address, notStaked.address, ""))
                .to.be.revertedWith("error_flagTargetNotStaked")
        })

        it("opens a flag and adds metadata to it", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target], [voter] ]
            } = await setupSponsorships(contracts, [2, 1], "flag-with-metadata")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, "{foo: true}"))
                .to.emit(sponsorship, "Flagged").withArgs(target.address, flagger.address, parseEther("100"), 1, "{foo: true}")
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "{foo: true}")

            const { flagData, flagMetadata } = await sponsorship.getFlag(target.address)
            expect(flagData).to.not.equal("0") // open
            expect(flagMetadata).to.equal("{foo: true}")
        })

        it("FAILS to flag if modules are not set", async function(): Promise<void> {
            const sponsorship = await (await ethers.getContractFactory("Sponsorship", { signer: admin })).deploy()
            await sponsorship.deployed()
            await sponsorship.initialize(
                "streamId",
                "metadata",
                contracts.streamrConfig.address,
                defaultSetup.token.address,
                [
                    0,
                    1,
                    parseEther("1").toString()
                ],
                contracts.allocationPolicy.address
            )

            await expect(sponsorship.flag(defaultSetup.sponsorships[0].address, ""))
                .to.be.revertedWithCustomError(sponsorship, "FlaggingNotSupported")
            await expect(sponsorship.voteOnFlag(defaultSetup.sponsorships[0].address, VOTE_KICK))
                .to.be.revertedWithCustomError(sponsorship, "FlaggingNotSupported")
            await expect(sponsorship.getFlag(defaultSetup.sponsorships[0].address))
                .to.be.revertedWithCustomError(sponsorship, "FlaggingNotSupported")
        })

        it("FAILS to flag self", async function(): Promise<void> {
            const { sponsorships: [ sponsorship ], operatorsPerSponsorship: [ [flagger] ] } = await defaultSetup
            await expect(flagger.flag(sponsorship.address, flagger.address, ""))
                .to.be.revertedWith("error_cannotFlagSelf")
        })

        it("FAILS if it can't find any live reviewers", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target ],
            } = await setupSponsorships(contracts, [2], "no-reviewers")
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.be.revertedWith("error_failedToFindReviewers")
        })

        it("FAILS if the target is under protection after NO_KICK vote", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "protection-after-no-kick")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship. address, target.address, VOTE_NO_KICK))
                .to.not.emit(sponsorship, "OperatorKicked")

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.be.revertedWith("error_cannotFlagAgain")
        })
    })

    describe("Voting", function(): void {
        it("FAILS before the voting starts", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "voting-too-early")

            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "")
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_votingNotStarted")
        })

        it("FAILS if already voted", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 3], "voting-too-early")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            await advanceToTimestamp(start + VOTE_START + 20, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.VOTING, 1, 0)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_alreadyVoted")
        })
    })

    describe("Vote resolution", function(): void {
        it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
            // TODO
        })

        it("results in NO_KICK if no one voted", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target ]
            } = await setupSponsorships(contracts, [2, 1], "no-one-votes")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(sponsorship.address, target.address, "")).wait()

            // attempting to vote actually ends the vote because voting period is over
            await advanceToTimestamp(start + VOTE_END + 10, "End vote")
            expect((await sponsorship.getFlag(target.address)).flagData).to.not.equal("0") // open
            await (await target.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // closed
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.RESULT_NO_KICK, 0, 0)

            // target is not kicked
            expect(await sponsorship.stakedWei(target.address)).to.not.equal("0")
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger already was kicked", async function(): Promise<void> {
            const {
                token, sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target], voters ]
            } = await setupSponsorships(contracts, [2, 5], "flagger-had-been-kicked")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(sponsorship.address, target.address, "")).wait()

            await advanceToTimestamp(start + 10, `${addr(target)} flags ${addr(flagger)}`)
            await (await target.flag(sponsorship.address, flagger.address, "")).wait()

            await advanceToTimestamp(start + VOTE_START + 20, `Voting to kick ${addr(flagger)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)).wait()
            await (await voters[4].voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)).wait()

            expect(await sponsorship.stakedWei(flagger.address)).to.equal("0") // flagger is kicked

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to not kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("2.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("2.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("2.0")
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger already forceUnstaked", async function(): Promise<void> {
            const {
                token, sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target], voters ]
            } = await setupSponsorships(contracts, [2, 5], "forceUnstaked-flagger")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(sponsorship.address, target.address, "")).wait()

            await advanceToTimestamp(start + 10, `${addr(flagger)} forceUnstakes`)
            const flaggerBalanceBefore = await token.balanceOf(flagger.address)
            await expect(flagger.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await (await flagger.forceUnstake(sponsorship.address, "1")).wait()
            const flaggerBalanceAfter = await token.balanceOf(flagger.address)

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to not kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.emit(sponsorship, "SponsorshipReceived").withArgs(sponsorship.address, parseEther("7")) // 3 goes to reviewers

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("1.0")

            expect(formatEther(flaggerBalanceBefore)).to.equal("0.0")
            expect(formatEther(flaggerBalanceAfter)).to.equal("990.0") // flag-stake was forfeited
        })

        it("pays flagger and reviewers who correctly voted KICK even if target already forceUnstaked", async function(): Promise<void> {
            const {
                token, sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target], voters ]
            } = await setupSponsorships(contracts, [2, 5], "target-forceUnstake", { sponsor: false })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(sponsorship.address, target.address, "")).wait()

            await advanceToTimestamp(start + 10, `${addr(target)} forceUnstakes`)
            expect(formatEther(await token.balanceOf(target.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("2000.0")
            await expect(target.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await (await target.forceUnstake(sponsorship.address, "1")).wait()
            expect(formatEther(await token.balanceOf(target.address))).to.equal("900.0") // slashingFraction of stake was forfeited
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("1100.0") // forfeited locked stake stays in the contract

            // leftovers are added as sponsorship: 100 slashed stake - (1 to flagger + 3 to reviewers) = 96 DATA
            await advanceToTimestamp(start + VOTE_START + 50, `Voting to kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.emit(sponsorship, "SponsorshipReceived").withArgs(sponsorship.address, parseEther("96"))

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("0.0")

            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("1096.0") // flagger's stake + new "sponsorships"
        })

        it("pays reviewers who correctly voted KICK when flagger forceUnstaked", async function(): Promise<void> {
            const {
                token, sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target], voters ]
            } = await setupSponsorships(contracts, [2, 5], "target-forceUnstake", { sponsor: false })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(sponsorship.address, target.address, "")).wait()

            await advanceToTimestamp(start + 10, `${addr(flagger)} forceUnstakes`)
            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("2000.0")
            await expect(flagger.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await (await flagger.forceUnstake(sponsorship.address, "1")).wait()
            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("990.0") // flagStakeWei was forfeited
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("1010.0") // forfeited locked stake stays in the contract

            // leftovers are added as sponsorship: 100 slashed stake + 10 forfeited flag stake - (3 to reviewers) = 107 DATA
            await advanceToTimestamp(start + VOTE_START + 50, `Voting to kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.emit(sponsorship, "SponsorshipReceived").withArgs(sponsorship.address, parseEther("107"))

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("990.0") // flagger didn't get new tokens
            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("1.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("0.0")

            // both flagger and target are gone, so no stakes left, only the new "sponsorships"
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("107.0")
        })

        it("can be triggered by anyone after the voting period is over", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target, nonVoter], voters ]
            } = await setupSponsorships(contracts, [4, 5], "flagger-had-been-kicked")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.not.emit(nonVoter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `Votes to (not) kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()

            await advanceToTimestamp(start + VOTE_END, `${addr(voters[4])} votes too late`)
            await (await voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved
            expect(await sponsorship.stakedWei(target.address)).to.be.greaterThan("0", "vote should end with NO_KICK, but ended with KICK")
        })
    })

    describe("Stake locking", (): void => {
        it("allows the target to reduce stake the correct amount DURING the flag period (to amount stake locked)", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "target-reducestake")

            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            const minimumStake = await sponsorship.minimumStakeOf(target.address)
            expect(formatEther(minimumStake)).to.equal("100.0")
            await expect(flagger.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await expect(target.reduceStakeTo(sponsorship.address, parseEther("99"))).to.be.revertedWithCustomError(sponsorship, "MinimumStake")
            await expect(target.reduceStakeTo(sponsorship.address, parseEther("100")))
                .to.emit(sponsorship, "StakeUpdate").withArgs(target.address, parseEther("100"), parseEther("0"), parseEther("100"))
        })

        it("allows the target to unstake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "target-after-flag")

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship. address, target.address, VOTE_NO_KICK))
                .to.not.emit(sponsorship, "OperatorKicked")

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            await expect(target.unstake(sponsorship.address))
                .to.emit(sponsorship, "OperatorLeft").withArgs(target.address, parseEther("1000"))
        })

        it("allows the flagger to reduce stake the correct amount DURING the flag period (to amount stake locked)", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, ...targets], [voter] ]
            } = await setupSponsorships(contracts, [8, 1], "flagger-reducestake")

            await expect(flagger.flag(sponsorship.address, targets[0].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[1].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[2].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[3].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[4].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[5].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[6].address, "")).to.emit(voter, "ReviewRequest")

            const minimumStake = await sponsorship.minimumStakeOf(flagger.address)
            expect(formatEther(minimumStake)).to.equal("70.0")
            await expect(flagger.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await expect(flagger.reduceStakeTo(sponsorship.address, parseEther("69"))).to.be.revertedWithCustomError(sponsorship, "MinimumStake")
            await expect(flagger.reduceStakeTo(sponsorship.address, parseEther("70")))
                .to.emit(sponsorship, "StakeUpdate").withArgs(flagger.address, parseEther("70"), parseEther("0"), parseEther("70"))
        })

        it("allows the flagger to unstake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "flagger-after-flag")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.not.emit(sponsorship, "OperatorKicked")

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            await expect(flagger.unstake(sponsorship.address))
                .to.emit(sponsorship, "OperatorLeft").withArgs(flagger.address, parseEther("999"))
        })

        it("does NOT allow the flagger to flag if he has not enough (unlocked) stake", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, ...targets], [voter] ]
            } = await setupSponsorships(contracts, [8, 1], "super-flagger", {
                stakeAmountWei: parseEther("68"), // flag-stake is 10 tokens
            })
            await expect(flagger.flag(sponsorship.address, targets[0].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[1].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[2].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[3].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[4].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[5].address, "")).to.emit(voter, "ReviewRequest")
            await expect(flagger.flag(sponsorship.address, targets[6].address, "")).to.be.revertedWith("error_notEnoughStake")
        })

        it("does NOT allow the flagger to flag if his stake has been slashed below minimum stake", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [3, 0], "flagger-slashed-below-minimum", {
                stakeAmountWei: await contracts.streamrConfig.minimumStakeWei()
            })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, "")).to.emit(voter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await (await voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("59.0") // paid one reviewer's fee

            await advanceToTimestamp(start + VOTE_START + 1000, `${addr(flagger)} tries to flag ${addr(voter)}`)
            await expect(flagger.flag(sponsorship.address, voter.address, "")).to.be.revertedWith("error_notEnoughStake")
        })

        it("ensures enough tokens to pay reviewers if flagger reduces stake to minimum then gets kicked", async function(): Promise<void> {
            // important that slashingFraction of minimumStakeWei is enough to pay reviewers
            // I.e. minimumStakeWei >= (flaggerRewardWei + flagReviewerCount * flagReviewerRewardWei) / slashingFraction

            const reviewerCount = +await contracts.streamrConfig.flagReviewerCount()
            const minimumStakeWei = await contracts.streamrConfig.minimumStakeWei()
            const flagStakeWei = await contracts.streamrConfig.flagStakeWei()
            const slashingFraction = (await contracts.streamrConfig.slashingFraction())
            // const flagReviewerRewardWei = parseEther("1")
            // const flaggerRewardWei = parseEther("1")
            // const totalRewardsWei =  flagReviewerRewardWei.mul(MAX_REVIEWERS).add(flaggerRewardWei)
            // const leftoverWei = flagStakeWei.sub(totalRewardsWei)

            const {
                token,
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, ...voters ],
            } = await setupSponsorships(contracts, [2, reviewerCount], "sufficient-flag-stake", {
                sponsor: false
            })
            const start = await getBlockTimestamp()
            const start2 = start + VOTE_START + 1000

            const minimumStake = await sponsorship.minimumStakeOf(flagger.address)
            expect(minimumStake).to.equal(minimumStakeWei)
            // can't flag unless stake is slashingFraction of flagStakeWei
            const flaggerStakeWei = max(minimumStake, flagStakeWei.mul(slashingFraction).div(parseEther("1")).add(1))
            await expect(flagger.reduceStakeTo(sponsorship.address, flaggerStakeWei))
                .to.emit(sponsorship, "StakeUpdate").withArgs(flagger.address, flaggerStakeWei, parseEther("0"), parseEther("0"))

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voters[0], "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            await advanceToTimestamp(start + VOTE_START, `${voters.map(addr).join(", ")} vote NO_KICK`)
            await Promise.all(voters.map(async (voter) => (await voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()))

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            await advanceToTimestamp(start2, `${addr(target)} flags ${addr(flagger)}`)
            await expect(target.flag(sponsorship.address, flagger.address, ""))
                .to.emit(voters[0], "ReviewRequest").withArgs(sponsorship.address, flagger.address, "")

            await advanceToTimestamp(start2 + VOTE_START, `Voters vote to KICK ${addr(flagger)}`)
            await Promise.all(voters.map(async (voter) => (await voter.voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)).wait()))

            expect(await sponsorship.stakedWei(flagger.address)).to.equal("0") // flagger is kicked

            await advanceToTimestamp(start2 + VOTE_START + 1000, "Everyone unstakes")
            await expect(target.unstake(sponsorship.address))
            expect(await sponsorship.totalStakedWei()).to.equal("0")

            // reviewers got paid for 2 reviews
            voters.forEach(async (voter) => {
                expect(formatEther(await token.balanceOf(voter.address))).to.equal("2.0")
            })

            // "counter-flagger" got paid for 1
            expect(formatEther(await token.balanceOf(target.address))).to.equal("1001.0")
        })

        it("ensures enough tokens are locked to pay reviewers if flagger gets maximally slashed then kicked", async function(): Promise<void> {
            // important that flagStakeWei is at least the slashingFraction of possible total reviewer rewards
            // because (flagStakeWei - reviewer rewards) * (number of flags) will be left to the flagger after maximal slashing
            const { sponsorships: [ sponsorship ], operators: [ flagger, ...targets ] } = await setupSponsorships(contracts, [7], "extreme-flagger", {
                stakeAmountWei: parseEther("67"), // flag-stake is 10 tokens
            })
            const start = await getBlockTimestamp()
            const start2 = start + VOTE_END + 5000

            // flagger flags everyone else
            // reset the random oracle for each flag to get full reviewer sets every time
            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            await (await flagger.flag(sponsorship.address, targets[0].address, "")).wait()
            await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()
            await (await flagger.flag(sponsorship.address, targets[1].address, "")).wait()
            await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()
            await (await flagger.flag(sponsorship.address, targets[2].address, "")).wait()
            await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()
            await (await flagger.flag(sponsorship.address, targets[3].address, "")).wait()
            await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()
            await (await flagger.flag(sponsorship.address, targets[4].address, "")).wait()
            await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()
            await (await flagger.flag(sponsorship.address, targets[5].address, "")).wait()

            await advanceToTimestamp(start + VOTE_START, "Targets vote NO_KICK")
            // const voters = targets.map((t) => targets.filter((t2) => t2.address !== t.address))
            for (const target of targets) {
                await Promise.all(targets.map(async (voter) => {
                    const tx = await (voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).catch(() => null)
                    if (tx) { return tx.wait() }
                }))
            }
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("37.0") // 67(original) - 6(flags) * 5(reviewers)

            await advanceToTimestamp(start + END_PROTECTION, `${addr(flagger)} tries to flag again`)
            await expect(flagger.flag(sponsorship.address, targets[5].address, ""))
                .to.be.revertedWith("error_notEnoughStake")

            await advanceToTimestamp(start2, `${addr(targets[0])} flags ${addr(flagger)}`)
            await expect(targets[0].flag(sponsorship.address, flagger.address, ""))
                .to.emit(targets[1], "ReviewRequest").withArgs(sponsorship.address, flagger.address, "")

            await advanceToTimestamp(start2 + VOTE_START, `Voters vote to KICK ${addr(flagger)}`)
            await Promise.all(targets.slice(1).map(async (voter) => voter.voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)))

            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("0.0") // flagger is kicked
        })

        it("flagger can open flags up to the staked amount minus the slashing amount if kicked", async function(): Promise<void> {
            const { streamrConfig } = contracts
            const minimumStakeWei = await streamrConfig.minimumStakeWei() // 60 tokens
            const { sponsorships: [ sponsorship ], operators: [ flagger, ...targets ] } = await setupSponsorships(contracts, [8], "max-flags", {
                stakeAmountWei: minimumStakeWei, // flag-stake is 10 tokens
            })

            const start = await getBlockTimestamp()
            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            await (await flagger.flag(sponsorship.address, targets[0].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[1].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[2].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[3].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[4].address, "")).wait()
            await expect(flagger.flag(sponsorship.address, targets[5].address, ""))
                .to.be.revertedWith("error_notEnoughStake")
        })

        it("ensures a flagger that opens flags maximally can still be flagged", async function(): Promise<void> {
            const { streamrConfig } = contracts

            const minimumStakeWei = await streamrConfig.minimumStakeWei() // 60 tokens
            const { sponsorships: [ sponsorship ], operators: [ flagger, ...targets ] } = await setupSponsorships(contracts, [7], "extreme-flagged", {
                stakeAmountWei: minimumStakeWei, // flag-stake is 10 tokens
            })

            const start = await getBlockTimestamp()
            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            await (await flagger.flag(sponsorship.address, targets[0].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[1].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[2].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[3].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[4].address, "")).wait()
            // flagger would still have 10 tokens left to flag (stakeWei - lockedStakeWei)
            // but forbitted to do so since there must be enough tokens to pay for a potential penalty kick as well
            await expect(flagger.flag(sponsorship.address, targets[5].address, ""))
                .to.be.revertedWith("error_notEnoughStake")

            // flagsCount * flagStakeWei => 5 * 10 = 50
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("50.0")

            await advanceToTimestamp(start + 1000, `${addr(targets[0])} flags ${addr(flagger)}`)
            await expect(targets[0].flag(sponsorship.address, flagger.address, ""))
                .to.emit(targets[1], "ReviewRequest").withArgs(sponsorship.address, flagger.address, "")

            // flagsCount * flagStakeWei - stakedWei * slashingFraction => 5 * 10 + 60 * 0.1 = 56
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("56.0")
            await expect(flagger.flag(sponsorship.address, targets[5].address, ""))
                .to.be.revertedWith("error_notEnoughStake")
        })

        it("ensures a flagger that opens flags maximally can still pay the early leave penalty", async function(): Promise<void> {
            const { token, streamrConfig } = contracts

            const minimumStakeWei = await streamrConfig.minimumStakeWei() // 60 tokens
            const { sponsorships: [ sponsorship ], operators: [ flagger, ...targets ] } = await setupSponsorships(contracts, [7], "extreme-flagged", {
                stakeAmountWei: minimumStakeWei, // flag-stake is 10 tokens
                sponsorshipSettings: { penaltyPeriodSeconds: await streamrConfig.maxPenaltyPeriodSeconds() }
            })

            const start = await getBlockTimestamp()
            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            await (await flagger.flag(sponsorship.address, targets[0].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[1].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[2].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[3].address, "")).wait()
            await (await flagger.flag(sponsorship.address, targets[4].address, "")).wait()
            // flagger would still have 10 tokens left to flag (stakeWei - lockedStakeWei)
            // but forbitted to do so since there must be enough tokens to pay for a potential early leave penalty (e.g. stake * slashingFraction)
            await expect(flagger.flag(sponsorship.address, targets[5].address, ""))
                .to.be.revertedWith("error_notEnoughStake")

            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("0.0")
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("60.0")
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("50.0") // flagsCount * flagStakeWei => 5 * 10 = 50

            await advanceToTimestamp(start + 1000, `${addr(targets[0])} flags ${addr(flagger)}`)
            await flagger.forceUnstake(sponsorship.address, 0)

            // staked - forfeited flag-stakes - leave penalty => 60 - 5 * 10 - 6
            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("4.0")

            // left the sponsorship => remaining stake was withdrawn
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("0.0")

            // left the sponsorship => lockedStakeWei is reset
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("0.0")
        })
    })

    describe("Access control", (): void => {
        describe("Non-staked (non-)operator", (): void => {
            it("cannot flag", async function(): Promise<void> {
                const {
                    sponsorships: [ sponsorship ],
                    operators
                } = defaultSetup
                await expect(sponsorship.connect(signers[6]).flag(operators[0].address, ""))
                    .to.be.revertedWith("error_notEnoughStake")
            })
            it("cannot voteOnFlag", async function(): Promise<void> {
                const {
                    sponsorships: [ sponsorship ],
                    operatorsPerSponsorship: [ [flagger, target], [voter] ]
                } = await setupSponsorships(contracts, [2, 1], "flag-with-metadata")
                const start = await getBlockTimestamp()
                const outsider = signers[5]

                // ...not before flagging
                await expect(sponsorship.connect(outsider).voteOnFlag(target.address, VOTE_KICK))
                    .to.be.revertedWith("error_notFlagged")

                // ...not after flagging
                await advanceToTimestamp(start, "Flagging")
                await expect(flagger.flag(sponsorship.address, target.address, "{}"))
                    .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "{}")
                await expect(sponsorship.connect(outsider).voteOnFlag(target.address, VOTE_KICK))
                    .to.be.revertedWith("error_votingNotStarted")

                // ...not after voting has started
                await advanceToTimestamp(start + VOTE_START, "Voting starts")
                await expect(sponsorship.connect(outsider).voteOnFlag(target.address, VOTE_KICK))
                    .to.be.revertedWith("error_reviewersOnly")

                // ...and not after voting has ended
                await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                    .to.not.emit(sponsorship, "OperatorKicked")
                await expect(sponsorship.connect(outsider).voteOnFlag(target.address, VOTE_KICK))
                    .to.be.revertedWith("error_notFlagged")
            })
        })
    })
})
