import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { setupSponsorships, SponsorshipTestSetup } from "../setupSponsorships"
import { advanceToTimestamp, getBlockTimestamp, VOTE_KICK, VOTE_NO_KICK, VOTE_START, VOTE_END, END_PROTECTION, log } from "../utils"

import type { MockRandomOracle, TestBadOperator } from "../../../../typechain"
import type { BigNumber, Wallet } from "ethers"
import { deployOperatorContract } from "../deployOperatorContract"

const {
    getContractFactory,
    utils: { parseEther, formatEther, getAddress, hexZeroPad },
    constants: { AddressZero }
} = hardhatEthers

function parseFlag(flagData: BigNumber) {
    return {
        flagger: getAddress(hexZeroPad(flagData.shr(96).mask(160).toHexString(), 20)),
        startDate: new Date(flagData.shr(64).mask(32).toNumber() * 1000),
        fractionForKick: flagData.shr(32).mask(32).toNumber() / 2**32,
        fractionAgainstKick: flagData.mask(32).toNumber() / 2**32,
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

describe("VoteKickPolicy", (): void => {
    let admin: Wallet
    let protocol: Wallet

    let mockRandomOracle: MockRandomOracle
    let contracts: TestContracts

    // default setup for test cases that don't need a clean set of contracts
    // clean setup is needed when review selection has to be controlled (so that Operators from old tests don't interfere)
    let defaultSetup: SponsorshipTestSetup

    let badOperatorTemplate: TestBadOperator

    before(async (): Promise<void> => {
        [admin, protocol] = await hardhatEthers.getSigners()
        contracts = await deployTestContracts(admin)

        const { streamrConfig } = contracts
        await (await streamrConfig.setProtocolFeeBeneficiary(protocol.address)).wait()
        await (await streamrConfig.setFlagReviewerCount(7)).wait()
        await (await streamrConfig.setFlagReviewerRewardWei(parseEther("20"))).wait()
        await (await streamrConfig.setFlaggerRewardWei(parseEther("360"))).wait()
        await (await streamrConfig.setFlagStakeWei(parseEther("500"))).wait()

        defaultSetup = await setupSponsorships(contracts, [3, 2], "default-setup")
        mockRandomOracle = await (await hardhatEthers.getContractFactory("MockRandomOracle", { signer: admin })).deploy()
        await (await contracts.streamrConfig.setRandomOracle(mockRandomOracle.address)).wait()

        badOperatorTemplate = await (await getContractFactory("TestBadOperator", admin)).deploy()
    })

    beforeEach(async () => {
        // For 3 operators, produces 1 2 2 2 2 1 1 0 0 2 2 1 1 0 0 2 2 1 1 0
        // For 5 operators, produces 4 2 2 4 4 3 3 2 2 1 1 0 0 4 4 3 3 2 2 1
        // For 7 operators, produces 6 1 2 5 3 4
        // For 9 operators, produces 4 5 8 8 2 7 4 3 3 5 8 4 1 0 0 2 5 1 7 6
        // For 11 operators, produces 9 6 2 7 6 9 3 8 10
        await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()

        // burn all protocolBeneficiary's tokens
        const protocolBalance = await contracts.token.balanceOf(protocol.address)
        await (await contracts.token.connect(protocol).transfer("0x1234000000000000000000000000000000000000", protocolBalance)).wait()
    })

    async function deployBadOperator(contracts: TestContracts, deployer: Wallet): Promise<TestBadOperator> {
        const { operatorFactory, operatorTemplate, nodeModule, queueModule, stakeModule } = contracts
        await expect(operatorFactory.updateTemplates(badOperatorTemplate.address, nodeModule.address, queueModule.address, stakeModule.address))
            .to.emit(operatorFactory, "TemplateAddresses")
        const badOperator = await deployOperatorContract(contracts, deployer)
        await expect(operatorFactory.updateTemplates(operatorTemplate.address, nodeModule.address, queueModule.address, stakeModule.address))
            .to.emit(operatorFactory, "TemplateAddresses")
        return badOperatorTemplate.attach(badOperator.address).connect(deployer)
    }

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
                .to.emit(sponsorship, "Flagged").withArgs(target.address, flagger.address, parseEther("1000"), 1, "{}")
                .to.emit(voter, "ReviewRequest")

            const stake = parseEther("10000")
            await advanceToTimestamp(start + VOTE_START, `${addr(flagger)} votes to kick ${addr(target)}`)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.VOTING, stake, 0, voter.address, stake)
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.RESULT_KICK, stake, 0, AddressZero, 0)
                .to.emit(sponsorship, "OperatorKicked").withArgs(target.address)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(target.address, parseEther("1000"))

            // kicked operator gets slashed the 10% slashingFraction
            expect(formatEther(await token.balanceOf(target.address))).to.equal("9000.0")
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
                .to.emit(sponsorship, "Flagged").withArgs(target.address, flagger.address, parseEther("1000"), 3, "")
                .to.emit(voter1, "ReviewRequest")
                .to.emit(voter2, "ReviewRequest")
                .to.emit(voter3, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `votes to kick ${addr(target)}`)
            await expect(voter1.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).to.emit(sponsorship, "FlagUpdate").withArgs(
                target.address, FlagState.VOTING, parseEther("10000"), 0, voter1.address, parseEther("10000")
            )
            await expect(voter2.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).to.emit(sponsorship, "FlagUpdate").withArgs(
                target.address, FlagState.VOTING, parseEther("10000"), parseEther("10000"), voter2.address, parseEther("-10000")
            )

            const { flagData } = await sponsorship.getFlag(target.address)
            expect(parseFlag(flagData)).to.contain({
                flagger: flagger.address,
                fractionForKick: 0.3333333332557231,
                fractionAgainstKick: 0.3333333332557231,
            })

            await expect(voter3.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).to.emit(sponsorship, "FlagUpdate").withArgs(
                target.address, FlagState.VOTING, parseEther("20000"), parseEther("10000"), voter3.address, parseEther("10000")
            ).to.emit(sponsorship, "FlagUpdate").withArgs(
                target.address, FlagState.RESULT_KICK, parseEther("20000"), parseEther("10000"), AddressZero, 0
            ).to.emit(sponsorship, "OperatorKicked").withArgs(
                target.address
            ).to.emit(sponsorship, "OperatorSlashed").withArgs(
                target.address, parseEther("1000")
            )
            expect(formatEther(await token.balanceOf(target.address))).to.equal("9000.0")

            expect(formatEther(await token.balanceOf(voter1.address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voter2.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voter3.address))).to.equal("20.0")
        })

        it("with 2 flags active at the same time (not interfere with each other)", async function(): Promise<void> {
            const {
                token,
                sponsorships: [ sponsorship ],
                operators: [ flagger1, flagger2, target1, target2, voter ],
            } = await setupSponsorships(contracts, [4, 1], "2-active-flags")
            const t1 = target1.address
            const t2 = target2.address
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(target1)} and ${addr(target2)} are flagged`)
            await expect(flagger1.flag(sponsorship.address, t1, ""))
                .to.emit(voter, "ReviewRequest")
                .to.emit(target2, "ReviewRequest")
                .to.emit(flagger2, "ReviewRequest")
            await expect(flagger2.flag(sponsorship.address, t2, ""))
                .to.emit(voter, "ReviewRequest")
                .to.emit(target1, "ReviewRequest")
                .to.emit(flagger1, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `votes to kick ${addr(target1)} and ${addr(target2)}`)
            await expect(flagger2.voteOnFlag(sponsorship.address, t1, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(t1, FlagState.VOTING, parseEther("10000"), 0, flagger2.address, parseEther("10000"))
            await expect(flagger1.voteOnFlag(sponsorship.address, t2, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(t2, FlagState.VOTING, parseEther("10000"), 0, flagger1.address, parseEther("10000"))
            await expect(target2.voteOnFlag(sponsorship.address, t1, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(t1, FlagState.VOTING, parseEther("20000"), 0, t2, parseEther("10000"))
            await expect(target1.voteOnFlag(sponsorship.address, t2, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(t2, FlagState.VOTING, parseEther("20000"), 0, t1, parseEther("10000"))

            await expect(voter.voteOnFlag(sponsorship.address, t1, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(t1, FlagState.RESULT_KICK, parseEther("30000"), 0, AddressZero, 0)
                .to.emit(sponsorship, "OperatorKicked").withArgs(t1)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(t1, parseEther("1000"))
            await expect(voter.voteOnFlag(sponsorship.address, t2, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(t2, FlagState.RESULT_KICK, parseEther("30000"), 0, AddressZero, 0)
                .to.emit(sponsorship, "OperatorKicked").withArgs(t2)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(t2, parseEther("1000"))

            // 1000 tokens slashing happens to target1 and target2
            expect(formatEther(await token.balanceOf(t1))).to.equal("9020.0") // (target +) voter + remaining stake
            expect(formatEther(await token.balanceOf(t2))).to.equal("9020.0") // voter (+ target) + remaining stake
            expect(formatEther(await token.balanceOf(flagger1.address))).to.equal("380.0")  // flagger 360 + voter 20
            expect(formatEther(await token.balanceOf(flagger2.address))).to.equal("380.0")  // voter 20 + flagger 360
            expect(formatEther(await token.balanceOf(voter.address))).to.equal("40.0")  // voter + voter
        })
    })

    describe("Reviewer selection", function(): void {
        // live = staked to any Sponsorship
        it("will only pick live reviewers", async () => {
            const { newContracts, sponsorships, operators: [
                flagger, target, voter, nonStaked
            ] } = await setupSponsorships(contracts, [2, 2], "pick-only-live-reviewers")

            await expect(nonStaked.unstake(sponsorships[1].address))
                .to.emit(newContracts.operatorFactory, "VoterUpdate").withArgs(nonStaked.address, false)
            await expect(flagger.flag(sponsorships[0].address, target.address, ""))
                .to.emit(voter, "ReviewRequest")
                .to.not.emit(nonStaked, "ReviewRequest")
        })

        it("biggest voter must lose if others vote differently", async () => {
            const {
                token, sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target], voters ]
            } = await setupSponsorships(contracts, [2, 5], "target-forceUnstake", { sponsor: false })
            const start = await getBlockTimestamp()

            // make one voter much bigger than others
            await (await token.mint(voters[0].address, parseEther("1000000"))).wait()

            // biggest voter's stake is capped to other voters' stakes - 1 wei
            const cappedStake = parseEther("40000").sub(1)

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(sponsorship.address, target.address, "")).wait()

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to kick ${addr(target)}`)
            await expect(voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.VOTING, cappedStake, 0, voters[0].address, cappedStake)
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            // target is not kicked
            expect(await sponsorship.stakedWei(target.address)).to.not.equal("0")
        })

        it("works even if voter candidate's onReviewRequest reverts (skip that voter)", async function(): Promise<void> {
            const { token } = contracts
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target ],
                newContracts
            } = await setupSponsorships(contracts, [2], "bad-voter")
            const signers = await hardhatEthers.getSigners()
            const badOperator = await deployBadOperator(newContracts, signers[6])
            await (await token.mint(badOperator.address, parseEther("100000"))).wait()
            await expect(await badOperator.stake(sponsorship.address, parseEther("100000"))).to.emit(sponsorship, "OperatorJoined")

            await (await badOperator.setReviewRequestReverting(true)).wait()
            await expect(flagger.flag(sponsorship.address, target.address, "")).to.be.rejectedWith("error_failedToFindReviewers")

            await (await badOperator.setReviewRequestReverting(false)).wait()
            await expect(flagger.flag(sponsorship.address, target.address, "")).to.emit(sponsorship, "Flagged")
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
                .to.emit(sponsorship, "Flagged").withArgs(target.address, flagger.address, parseEther("1000"), 1, "{foo: true}")
                .to.emit(voter, "ReviewRequest")

            const { flagData, flagMetadata } = await sponsorship.getFlag(target.address)
            expect(parseFlag(flagData)).to.contain({
                flagger: flagger.address,
                fractionForKick: 0,
                fractionAgainstKick: 0,
            })
            expect(flagMetadata).to.equal("{foo: true}")
        })

        it("FAILS to flag if modules are not set", async function(): Promise<void> {
            const sponsorship = await (await hardhatEthers.getContractFactory("Sponsorship", { signer: admin })).deploy()
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
            expect(await sponsorship.minimumStakeOf(admin.address)).to.equal("0")
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
                .to.emit(voter, "ReviewRequest")

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
                .to.emit(voter, "ReviewRequest")
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_votingNotStarted")
        })

        it("FAILS if already voted", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 2], "voting-two-times")
            const voterStake = parseEther("10000")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START + 20, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.VOTING, voterStake, 0, voter.address, voterStake)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_alreadyVoted")
        })
    })

    describe("Vote resolution", function(): void {
        it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
            // TODO
        })

        it("results in NO_KICK if there was a tie", async function(): Promise<void> {
            const {
                sponsorships: [ s ],
                operatorsPerSponsorship: [ [flagger, target], voters ]
            } = await setupSponsorships(contracts, [2, 4], "tie")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(s.address, target.address, "")).wait()

            await advanceToTimestamp(start + VOTE_START + 20, `Voting to kick ${addr(flagger)}`)
            await (await voters[0].voteOnFlag(s.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(s.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(s.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[3].voteOnFlag(s.address, target.address, VOTE_NO_KICK))
                .to.emit(s, "FlagUpdate").withArgs(target.address, FlagState.RESULT_NO_KICK, parseEther("20000"), parseEther("20000"), AddressZero, 0)
        })

        it("results in NO_KICK if no one voted, flagger doesn't lose stake", async function(): Promise<void> {
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
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.RESULT_NO_KICK, 0, 0, AddressZero, 0)

            // target is not kicked, keeps stake
            expect(formatEther(await sponsorship.stakedWei(target.address))).to.equal("10000.0")

            // flagger didn't lose stake either because no reviewer got paid
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("10000.0")
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
            await expect(voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.emit(sponsorship, "FlagUpdate")
                .withArgs(target.address, FlagState.RESULT_NO_KICK, parseEther("20000"), parseEther("30000"), AddressZero, 0)

            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("40.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("40.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("40.0")
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
                .to.emit(sponsorship, "FlagUpdate")
                .withArgs(target.address, FlagState.RESULT_NO_KICK, parseEther("20000"), parseEther("30000"), AddressZero, 0)

            // leftovers: 500 flag stake - 3 * 20 to reviewers = 440 DATA
            expect(formatEther(await token.balanceOf(protocol.address))).to.equal("440.0")
            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("20.0")

            expect(formatEther(flaggerBalanceBefore)).to.equal("0.0")
            expect(formatEther(flaggerBalanceAfter)).to.equal("9500.0") // flag-stake 500 was forfeited
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
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("20000.0")
            await expect(target.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await (await target.forceUnstake(sponsorship.address, "1")).wait()
            expect(formatEther(await token.balanceOf(target.address))).to.equal("9000.0") // slashingFraction of stake was forfeited
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("11000.0") // forfeited locked stake stays in the contract

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.emit(sponsorship, "FlagUpdate")
                .withArgs(target.address, FlagState.RESULT_KICK, parseEther("30000"), parseEther("20000"), AddressZero, 0)

            // leftovers: 1000 slashed stake - (360 to flagger + 3 * 20 to reviewers) = 580 DATA
            expect(formatEther(await token.balanceOf(protocol.address))).to.equal("580.0")
            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("360.0")
            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("10000.0") // flagger is still staked
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
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("20000.0")
            await expect(flagger.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await (await flagger.forceUnstake(sponsorship.address, "1")).wait()
            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("9500.0") // flagStakeWei was forfeited
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("10500.0") // forfeited locked stake stays in the contract

            await advanceToTimestamp(start + VOTE_START + 50, `Voting to kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await expect(voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.emit(sponsorship, "FlagUpdate")
                .withArgs(target.address, FlagState.RESULT_KICK, parseEther("30000"), parseEther("20000"), AddressZero, 0)

            // leftovers are added as sponsorship: 1000 slashed stake + 500 forfeited flag stake - (3 * 20 to reviewers) = 1440 DATA
            expect(formatEther(await token.balanceOf(protocol.address))).to.equal("1440.0")
            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("9500.0") // flagger didn't get new tokens
            expect(formatEther(await token.balanceOf(voters[0].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[1].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[2].address))).to.equal("20.0")
            expect(formatEther(await token.balanceOf(voters[3].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(voters[4].address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("0.0") // both flagger and target are gone, so no stakes left
        })

        it("can be triggered by anyone after the voting period is over", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operatorsPerSponsorship: [ [flagger, target], [voter0, voter1, nonVoter,, voter2, voter3] ]
            } = await setupSponsorships(contracts, [2, 9], "non-voter-triggers-resolution")
            const start = await getBlockTimestamp()

            // For 11 operators, produces 9 6 2 7 6 9 3 8 10
            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.not.emit(nonVoter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `Votes to (not) kick ${addr(target)}`)
            await (await voter0.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voter1.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voter2.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await (await voter3.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()
            await expect(nonVoter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_reviewersOnly")

            await advanceToTimestamp(start + VOTE_END, `${addr(nonVoter)} triggers vote resolution`)
            await (await nonVoter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved
            expect(await sponsorship.stakedWei(target.address)).to.be.greaterThan("0", "vote should end with NO_KICK, but ended with KICK")
        })

        it("works even if flagger's transferAndCall reverts", async function(): Promise<void> {
            const { token } = contracts
            const {
                sponsorships: [ sponsorship ],
                operators: [ target, voter ],
                newContracts
            } = await setupSponsorships(contracts, [2], "bad-flagger")
            const signers = await hardhatEthers.getSigners()
            const badOperator = await deployBadOperator(newContracts, signers[6])
            await (await token.mint(badOperator.address, parseEther("100000"))).wait()
            await expect(await badOperator.stake(sponsorship.address, parseEther("100000"))).to.emit(sponsorship, "OperatorJoined")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(badOperator)} flags ${addr(target)}`)
            await expect(badOperator.flag(sponsorship.address, target.address, "")).to.emit(voter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).to.emit(sponsorship, "FlagUpdate")
        })

        it("works even if voter's transferAndCall reverts", async function(): Promise<void> {
            const { token } = contracts
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, target2 ],
                newContracts
            } = await setupSponsorships(contracts, [3], "bad-voter")
            const signers = await hardhatEthers.getSigners()
            const badOperator = await deployBadOperator(newContracts, signers[6])
            await (await token.mint(badOperator.address, parseEther("100000"))).wait()
            await expect(await badOperator.stake(sponsorship.address, parseEther("100000"))).to.emit(sponsorship, "OperatorJoined")

            const start = await getBlockTimestamp()
            await advanceToTimestamp(start, `${addr(badOperator)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, "")).to.emit(sponsorship, "Flagged")

            await advanceToTimestamp(start + VOTE_START, "voting")
            await expect(target2.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).to.emit(sponsorship, "FlagUpdate")
            await expect(badOperator.voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).to.emit(sponsorship, "FlagUpdate")

            const start2 = await getBlockTimestamp()
            await advanceToTimestamp(start2, `${addr(badOperator)} flags ${addr(target2)}`)
            await expect(flagger.flag(sponsorship.address, target2.address, "")).to.emit(sponsorship, "Flagged")

            await advanceToTimestamp(start2 + VOTE_START, `${addr(badOperator)} votes`)
            await expect(badOperator.voteOnFlag(sponsorship.address, target2.address, VOTE_NO_KICK)).to.emit(sponsorship, "FlagUpdate")
        })
    })

    describe("Stake locking", (): void => {
        it("allows the target to reduce stake the correct amount DURING the flag period", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "target-reducestake", {
                stakeAmountWei: parseEther("100000")
            })

            expect(formatEther(await sponsorship.minimumStakeOf(target.address))).to.equal("5000.0")

            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest")

            expect(formatEther(await sponsorship.minimumStakeOf(target.address))).to.equal("10000.0")

            await expect(flagger.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await expect(target.reduceStakeTo(sponsorship.address, parseEther("9999"))).to.be.revertedWithCustomError(sponsorship, "MinimumStake")
            await expect(target.reduceStakeTo(sponsorship.address, parseEther("10000")))
                .to.emit(sponsorship, "StakeUpdate").withArgs(target.address, parseEther("10000"), parseEther("0"))
        })

        it("allows the target to unstake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "target-after-flag")

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship. address, target.address, VOTE_NO_KICK))
                .to.not.emit(sponsorship, "OperatorKicked")

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            await expect(target.unstake(sponsorship.address))
                .to.emit(sponsorship, "OperatorLeft").withArgs(target.address, parseEther("10000"))
        })

        it("allows the flagger to reduce stake the correct amount DURING the flag period", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [flagger, ...targets]
            } = await setupSponsorships(contracts, [13], "flagger-reducestake", {
                stakeAmountWei: parseEther("100000")
            })

            /* eslint-disable max-len */
            await expect(flagger.flag(sponsorship.address, targets[0].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("500"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[1].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("1000"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[2].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("1500"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[3].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("2000"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[4].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("2500"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[5].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("3000"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[6].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("3500"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[7].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("4000"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[8].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("4500"), parseEther("5000"))
            await expect(flagger.flag(sponsorship.address, targets[9].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("5000"), parseEther("5555.555555555555555556"))
            await expect(flagger.flag(sponsorship.address, targets[10].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("5500"), parseEther("6111.111111111111111112"))
            await expect(flagger.flag(sponsorship.address, targets[11].address, "")).to.emit(sponsorship, "StakeLockUpdate").withArgs(flagger.address, parseEther("6000"), parseEther("6666.666666666666666667"))
            /* eslint-enable max-len */

            // lockedStake 12 * 500 = 6000, plus room for 10% slashing = 6666.66...
            // 6666.66... > global minimumStake 5000 ==> flagger's minimumStake = 6666.66...
            expect(formatEther(await sponsorship.minimumStakeOf(flagger.address))).to.equal("6666.666666666666666667")
            await expect(flagger.unstake(sponsorship.address)).to.be.revertedWithCustomError(sponsorship, "ActiveFlag")
            await expect(flagger.reduceStakeTo(sponsorship.address, parseEther("6666"))).to.be.revertedWithCustomError(sponsorship, "MinimumStake")
            await expect(flagger.reduceStakeTo(sponsorship.address, parseEther("6666.666666666666666667")))
                .to.emit(sponsorship, "StakeUpdate").withArgs(flagger.address, parseEther("6666.666666666666666667"), parseEther("0"))
        })

        it("allows the flagger to unstake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(contracts, [2, 1], "flagger-after-flag")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK))
                .to.not.emit(sponsorship, "OperatorKicked")

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            // original stake was 10000, reviewer reward is 20 => get back 9980
            await expect(flagger.unstake(sponsorship.address))
                .to.emit(sponsorship, "OperatorLeft").withArgs(flagger.address, parseEther("9980"))
        })

        it("does NOT allow the flagger to flag if he has not enough (unlocked) stake", async function(): Promise<void> {
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, ...targets ]
            } = await setupSponsorships(contracts, [11], "not-enough-stake-to-flag", {
                stakeAmountWei: parseEther("5000"), // flag-stake is 500 tokens
            })
            // flagger can open flags up to the staked amount minus the slashing amount if kicked
            // slashing amount is 5000 * 0.1 = 500, so max flag-stake-sum is 4500 = 9 flags
            await expect(flagger.flag(sponsorship.address, targets[0].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[1].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[2].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[3].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[4].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[5].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[6].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[7].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[8].address, "")).to.emit(sponsorship, "Flagged")
            await expect(flagger.flag(sponsorship.address, targets[9].address, "")).to.be.revertedWith("error_notEnoughStake")
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

            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("4980.0") // paid one reviewer's fee 20

            await advanceToTimestamp(start + VOTE_START + 1000, `${addr(flagger)} tries to flag ${addr(voter)}`)
            await expect(flagger.flag(sponsorship.address, voter.address, "")).to.be.revertedWith("error_notEnoughStake")
        })

        it("ensures enough tokens to pay reviewers if flagger reduces stake to minimum then gets kicked", async function(): Promise<void> {
            // TODO: check that slashingFraction of minimumStakeWei is enough to pay reviewers
            // I.e. minimumStakeWei >= (flaggerRewardWei + flagReviewerCount * flagReviewerRewardWei) / slashingFraction

            const reviewerCount = +await contracts.streamrConfig.flagReviewerCount()
            const minimumStakeWei = await contracts.streamrConfig.minimumStakeWei()
            const {
                token,
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, ...voters ],
            } = await setupSponsorships(contracts, [2, reviewerCount], "sufficient-flag-stake", {
                sponsor: false
            })
            const start = await getBlockTimestamp()
            const start2 = start + VOTE_START + 1000

            expect(await sponsorship.minimumStakeOf(flagger.address)).to.equal(minimumStakeWei)

            await expect(flagger.reduceStakeTo(sponsorship.address, minimumStakeWei))
                .to.emit(sponsorship, "StakeUpdate").withArgs(flagger.address, minimumStakeWei, parseEther("0"))

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voters[0], "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START, `${voters.map(addr).join(", ")} vote NO_KICK`)
            await Promise.all(voters.map(async (voter) => (await voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).wait()))

            expect((await sponsorship.getFlag(target.address)).flagData).to.equal("0") // flag is resolved

            await advanceToTimestamp(start2, `${addr(target)} flags ${addr(flagger)}`)
            await expect(target.flag(sponsorship.address, flagger.address, ""))
                .to.emit(voters[0], "ReviewRequest")

            await advanceToTimestamp(start2 + VOTE_START, `Voters vote to KICK ${addr(flagger)}`)
            await Promise.all(voters.map(async (voter) => (await voter.voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK)).wait()))

            expect(await sponsorship.stakedWei(flagger.address)).to.equal("0") // flagger is kicked

            await advanceToTimestamp(start2 + VOTE_START + 1000, "Everyone unstakes")
            await expect(target.unstake(sponsorship.address))
            expect(await sponsorship.totalStakedWei()).to.equal("0")

            // reviewers got paid for 2 reviews
            for (const voter of voters) {
                expect(formatEther(await token.balanceOf(voter.address))).to.equal("40.0")
            }

            // "counter-flagger" got paid for 1 correct flag
            expect(formatEther(await token.balanceOf(target.address))).to.equal("10360.0")
        })

        it("ensures enough tokens are locked to pay reviewers if flagger gets maximally slashed then kicked", async function(): Promise<void> {
            // important that flagStakeWei is at least the slashingFraction of possible total reviewer rewards
            // because (flagStakeWei - reviewer rewards) * (number of flags) will be left to the flagger after maximal slashing
            // maximal flagging is 9 flags, see "not enough (unlocked) stake" test case
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, ...targets ]
            } = await setupSponsorships(contracts, [10], "extreme-flagger", {
                stakeAmountWei: parseEther("5000"), // flag-stake is 500 tokens
            })
            const start = await getBlockTimestamp()
            const start2 = start + VOTE_END + 5000

            // flagger flags everyone else
            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            for (const target of targets) {
                // reset the random oracle for each flag to get full reviewer sets every time
                await (await mockRandomOracle.setOutcomes([ "0x0001000100010001000100010001000100010001000100010001000100030002" ])).wait()
                await (await flagger.flag(sponsorship.address, target.address, "")).wait()
            }

            await advanceToTimestamp(start + VOTE_START, "Targets vote NO_KICK")
            for (const target of targets) {
                await Promise.all(targets.map(async (voter) => {
                    const tx = await (voter.voteOnFlag(sponsorship.address, target.address, VOTE_NO_KICK)).catch(() => null)
                    if (tx) { return tx.wait() }
                }))
            }
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("3740.0") // 5000(original) - 9(flags) * 140(reviewers)

            await advanceToTimestamp(start + END_PROTECTION, `${addr(flagger)} tries to flag again`)
            await expect(flagger.flag(sponsorship.address, targets[5].address, ""))
                .to.be.revertedWith("error_notEnoughStake")

            await advanceToTimestamp(start2, `${addr(targets[0])} flags ${addr(flagger)}`)
            await expect(targets[0].flag(sponsorship.address, flagger.address, ""))
                .to.emit(targets[1], "ReviewRequest")

            await advanceToTimestamp(start2 + VOTE_START, `Voters vote to KICK ${addr(flagger)}`)
            await Promise.all(targets.slice(1).map(async (voter) => {
                const tx = await voter.voteOnFlag(sponsorship.address, flagger.address, VOTE_KICK).catch(() => null)
                if (tx) { return tx.wait() }
            }))

            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("0.0") // flagger is kicked
        })

        it("ensures a flagger that opens flags maximally can still be flagged", async function(): Promise<void> {
            // maximal flagging is 9 flags, see "not enough (unlocked) stake" test case
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, ...targets ]
            } = await setupSponsorships(contracts, [11], "extreme-flagged", {
                stakeAmountWei: parseEther("5000"), // flag-stake is 500 tokens
            })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            for (const target of targets.slice(0, 9)) {
                await (await flagger.flag(sponsorship.address, target.address, "")).wait()
            }

            // flagger would still have 500 tokens left to flag (stakeWei - lockedStakeWei)
            //   but forbitted to do so since there must be enough tokens to pay for a potential penalty of kick as well
            await expect(flagger.flag(sponsorship.address, targets[9].address, ""))
                .to.be.revertedWith("error_notEnoughStake")

            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("4500.0")

            await advanceToTimestamp(start + 1000, `${addr(targets[0])} flags ${addr(flagger)}`)
            await expect(targets[0].flag(sponsorship.address, flagger.address, ""))
                .to.emit(targets[1], "ReviewRequest")

            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("5000.0")

            await expect(flagger.flag(sponsorship.address, targets[9].address, ""))
                .to.be.revertedWith("error_notEnoughStake")
        })

        it("ensures a super-flagger that reduces stake to minimum can still be flagged", async function(): Promise<void> {
            // maximal flagging is 9 flags, see "not enough (unlocked) stake" test case
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, ...targets ]
            } = await setupSponsorships(contracts, [19], "super-flagger", {
                stakeAmountWei: parseEther("15000"), // flag-stake is 500 tokens
            })

            log(`${addr(flagger)} flags`)
            async function flagAndExpectStakeLockUpdate(index: number, expectedLockedStakeWei: BigNumber, expectedMinimumStakeWei: BigNumber) {
                log(`  ${index}: ${addr(targets[index])}`)
                await expect(flagger.flag(sponsorship.address, targets[index].address, ""))
                    .to.emit(sponsorship, "StakeLockUpdate")
                    .withArgs(flagger.address, expectedLockedStakeWei, expectedMinimumStakeWei)
            }
            await flagAndExpectStakeLockUpdate(0, parseEther("500"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(1, parseEther("1000"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(2, parseEther("1500"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(3, parseEther("2000"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(4, parseEther("2500"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(5, parseEther("3000"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(6, parseEther("3500"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(7, parseEther("4000"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(8, parseEther("4500"), parseEther("5000"))
            await flagAndExpectStakeLockUpdate(9, parseEther("5000"), parseEther("5555.555555555555555556"))
            await flagAndExpectStakeLockUpdate(10, parseEther("5500"), parseEther("6111.111111111111111112"))
            await flagAndExpectStakeLockUpdate(11, parseEther("6000"), parseEther("6666.666666666666666667"))
            await flagAndExpectStakeLockUpdate(12, parseEther("6500"), parseEther("7222.222222222222222223"))
            await flagAndExpectStakeLockUpdate(13, parseEther("7000"), parseEther("7777.777777777777777778"))
            await flagAndExpectStakeLockUpdate(14, parseEther("7500"), parseEther("8333.333333333333333334"))
            await flagAndExpectStakeLockUpdate(15, parseEther("8000"), parseEther("8888.888888888888888889"))
            await flagAndExpectStakeLockUpdate(16, parseEther("8500"), parseEther("9444.444444444444444445"))
            await flagAndExpectStakeLockUpdate(17, parseEther("9000"), parseEther("10000"))

            // lockedStake 18 * 500 = 9000, plus room for 10% slashing = 10000
            // 10000 > global minimumStake 5000 ==> flagger's minimumStake = 10000
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("9000.0")
            expect(formatEther(await sponsorship.minimumStakeOf(flagger.address))).to.equal("10000.0")
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("15000.0")

            await expect(flagger.reduceStakeTo(sponsorship.address, parseEther("10000")))
                .to.emit(sponsorship, "StakeUpdate").withArgs(flagger.address, parseEther("10000"), parseEther("0"))

            // expecting to be able to open the flag
            await expect(targets[0].flag(sponsorship.address, flagger.address, ""))
                .to.emit(sponsorship, "Flagged").withArgs(flagger.address, targets[0].address, parseEther("1000"), 7, "")

            // now all of the stake is locked
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("10000.0")
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("10000.0")
            expect(formatEther(await sponsorship.minimumStakeOf(flagger.address))).to.equal("10000.0")
        })

        it("ensures a flagger that opens flags maximally can still pay the early leave penalty", async function(): Promise<void> {
            const { token, streamrConfig } = contracts

            // maximal flagging is 9 flags, see "not enough (unlocked) stake" test case
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, ...targets ]
            } = await setupSponsorships(contracts, [11], "extreme-leaver", {
                stakeAmountWei: parseEther("5000"), // flag-stake is 500 tokens
                sponsorshipSettings: { penaltyPeriodSeconds: await streamrConfig.maxPenaltyPeriodSeconds() }
            })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${targets.map(addr).join(", ")}`)
            for (const target of targets.slice(0, 9)) {
                await (await flagger.flag(sponsorship.address, target.address, "")).wait()
            }

            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("0.0")
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("5000.0")
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("4500.0")

            await advanceToTimestamp(start + 1000, `${addr(targets[0])} flags ${addr(flagger)}`)
            await flagger.forceUnstake(sponsorship.address, 0)

            // staked - forfeited flag-stakes - leave penalty => 5000 - 4500 - 500 = 0
            expect(formatEther(await token.balanceOf(flagger.address))).to.equal("0.0")

            // left the sponsorship => remaining stake was withdrawn
            expect(formatEther(await sponsorship.stakedWei(flagger.address))).to.equal("0.0")

            // left the sponsorship => lockedStakeWei is reset
            expect(formatEther(await sponsorship.lockedStakeWei(flagger.address))).to.equal("0.0")
        })

        it("works with rounding errors from slashingFractions like 30%", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            await (await contracts.streamrConfig.setSlashingFraction(parseEther("0.6"))).wait()

            const minimumStakeWei = await contracts.streamrConfig.minimumStakeWei()
            expect(minimumStakeWei).to.equal("833333333333333333334") // if we were rounding minimumStake down: 83...33

            const {
                token,
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, ...voters ]
            } = await setupSponsorships(contracts, [9], "one-of-each", { stakeAmountWei: minimumStakeWei })

            // await (await flagger.unstake(sponsorship.address)).wait()
            // flagger needs to add flagStakeWei more to be able to flag
            await (await token.mint(await flagger.owner(), parseEther("500"))).wait()
            await (await token.connect(flagger.signer).transferAndCall(flagger.address, parseEther("500"), "0x")).wait()
            await flagger.stake(sponsorship.address, parseEther("500"))

            // if we were rounding minimumStake down, we'd lock too little stake: parseEther("500").sub(1)
            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(sponsorship.address, target.address, "{}"))
                .to.emit(sponsorship, "Flagged").withArgs(target.address, flagger.address, parseEther("500"), 7, "{}")

            // if we were rounding minimumStake down, here we could not pay every reviewer; total payments: parseEther("500") (flagStake)
            await advanceToTimestamp(start + VOTE_START, `${addr(flagger)} votes to kick ${addr(target)}`)
            await (await voters[0].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[1].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[2].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[3].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[4].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await (await voters[5].voteOnFlag(sponsorship.address, target.address, VOTE_KICK)).wait()
            await expect(voters[6].voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(sponsorship, "FlagUpdate").withArgs(target.address, FlagState.RESULT_KICK, minimumStakeWei.mul(7), 0, AddressZero, 0)
                .to.emit(sponsorship, "OperatorKicked").withArgs(target.address)
                .to.emit(sponsorship, "OperatorSlashed").withArgs(target.address, parseEther("500"))

            expect(formatEther(await token.balanceOf(target.address))).to.equal("333.333333333333333334")

            await (await contracts.streamrConfig.setSlashingFraction(parseEther("0.1"))).wait()
        })

        it("stake gets unlocked if there's only a little unlocked stake left (KICK branch)", async function(): Promise<void> {
            // This is how locked stake can get split between locked and forfeited stake:
            // A, B, C, D stake 7000
            // B flags A => targetStakeAtRisk = 700
            // A forceunstakes => forfeitedStake = 700
            // A stakes again
            // A flags B, C, D => 3 * 500 = A's locked stake > targetStakeAtRisk = 700
            // B-A flag resolves with NO_KICK => A's locked stake = 3 * 500 - targetStakeAtRisk = 800
            // A-C flag resolves with NO_KICK => A's locked stake = 800 - flagStake = 300
            // after A-D flag resolves, A's locked stake should be zero, and forfeitedStake should be 200 less
            const {
                sponsorships: [ s ],
                operators: [ a, b, c, d ]
            } = await setupSponsorships(contracts, [4], "split-locked-stake", {
                stakeAmountWei: parseEther("7000"), // flag-stake is 500 tokens
            })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, "flagging")
            await expect(b.flag(s.address, a.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("700"), parseEther("5000"))
            await expect(a.forceUnstake(s.address, 0)).to.emit(s, "OperatorLeft").withArgs(a.address, parseEther("6300"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("700"))
            await expect(a.stake(s.address, parseEther("6300"))).to.emit(s, "StakeUpdate").withArgs(a.address, parseEther("6300"), parseEther("0"))
            await expect(a.flag(s.address, b.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("500"), parseEther("5000"))
            await expect(a.flag(s.address, c.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("1000"), parseEther("5000"))
            await expect(a.flag(s.address, d.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("1500"), parseEther("5000"))

            // NO_KICK "accidentally" unlocks flagstake-lockings worth targetAtRisk, but that's okay:
            //   the targetAtRisk is in forfeitedStake, and later the flagstake-unlockings will decrease forfeitedStake. Sums match.
            await advanceToTimestamp(start + VOTE_START, "voting")
            await expect(c.voteOnFlag(s.address, a.address, VOTE_NO_KICK)).to.emit(s, "FlagUpdate")
            await expect(d.voteOnFlag(s.address, a.address, VOTE_NO_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("800"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("700"))

            await expect(b.voteOnFlag(s.address, c.address, VOTE_NO_KICK)).to.emit(s, "FlagUpdate")
            await expect(d.voteOnFlag(s.address, c.address, VOTE_NO_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("300"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("700"))

            // notice how the lockings are now split between locked and forfeited stake
            // especially note how lockedStake < flagStake, so we'll end up in the "else" branch in flagger-stake unlocking despite being staked!
            await expect(b.voteOnFlag(s.address, d.address, VOTE_KICK)).to.emit(s, "FlagUpdate")
            await expect(c.voteOnFlag(s.address, d.address, VOTE_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("0"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("500"))

            await expect(c.voteOnFlag(s.address, b.address, VOTE_KICK)).to.emit(s, "FlagUpdate")
            await expect(d.voteOnFlag(s.address, b.address, VOTE_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("0"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("0"))
        })

        it("stake gets unlocked if there's only a little unlocked stake left (NO_KICK branch)", async function(): Promise<void> {
            // This is how locked stake can get split between locked and forfeited stake:
            // A, B, C, D stake 7000
            // B flags A => targetStakeAtRisk = 700
            // A forceunstakes => forfeitedStake = 700
            // A stakes again
            // A flags B, C, D => 3 * 500 = A's locked stake > targetStakeAtRisk = 700
            // B-A flag resolves with NO_KICK => A's locked stake = 3 * 500 - targetStakeAtRisk = 800
            // A-C flag resolves with NO_KICK => A's locked stake = 800 - flagStake = 300
            // after A-D flag resolves, A's locked stake should be zero, and forfeitedStake should be 200 less
            const {
                sponsorships: [ s ],
                operators: [ a, b, c, d ]
            } = await setupSponsorships(contracts, [4], "split-locked-stake", {
                stakeAmountWei: parseEther("7000"), // flag-stake is 500 tokens
            })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, "flagging")
            await expect(b.flag(s.address, a.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("700"), parseEther("5000"))
            await expect(a.forceUnstake(s.address, 0)).to.emit(s, "OperatorLeft").withArgs(a.address, parseEther("6300"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("700"))
            await expect(a.stake(s.address, parseEther("6300"))).to.emit(s, "StakeUpdate").withArgs(a.address, parseEther("6300"), parseEther("0"))
            await expect(a.flag(s.address, b.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("500"), parseEther("5000"))
            await expect(a.flag(s.address, c.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("1000"), parseEther("5000"))
            await expect(a.flag(s.address, d.address, "")).to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("1500"), parseEther("5000"))

            // NO_KICK "accidentally" unlocks flagstake-lockings worth targetAtRisk, but that's okay:
            //   the targetAtRisk is in forfeitedStake, and later the flagstake-unlockings will decrease forfeitedStake. Sums match.
            await advanceToTimestamp(start + VOTE_START, "voting")
            await expect(c.voteOnFlag(s.address, a.address, VOTE_NO_KICK)).to.emit(s, "FlagUpdate")
            await expect(d.voteOnFlag(s.address, a.address, VOTE_NO_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("800"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("700"))

            await expect(b.voteOnFlag(s.address, c.address, VOTE_NO_KICK)).to.emit(s, "FlagUpdate")
            await expect(d.voteOnFlag(s.address, c.address, VOTE_NO_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("300"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("700"))

            // notice how the lockings are now split between locked and forfeited stake
            // especially note how lockedStake < flagStake, so we'll end up in the "else" branch in flagger-stake unlocking despite being staked!
            await expect(b.voteOnFlag(s.address, d.address, VOTE_NO_KICK)).to.emit(s, "FlagUpdate")
            await expect(c.voteOnFlag(s.address, d.address, VOTE_NO_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("0"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("500"))

            await expect(c.voteOnFlag(s.address, b.address, VOTE_NO_KICK)).to.emit(s, "FlagUpdate")
            await expect(d.voteOnFlag(s.address, b.address, VOTE_NO_KICK))
                .to.emit(s, "StakeLockUpdate").withArgs(a.address, parseEther("0"), parseEther("5000"))
            expect(await s.forfeitedStakeWei()).to.equal(parseEther("0"))
        })
    })

    describe("Access control", (): void => {
        describe("Non-staked (non-)operator", (): void => {
            it("cannot flag", async function(): Promise<void> {
                const {
                    sponsorships: [ sponsorship ],
                    operators
                } = defaultSetup
                const signers = await hardhatEthers.getSigners()
                await expect(sponsorship.connect(signers[6]).flag(operators[0].address, ""))
                    .to.be.revertedWith("error_notEnoughStake")
            })
            it("cannot voteOnFlag", async function(): Promise<void> {
                const {
                    sponsorships: [ sponsorship ],
                    operatorsPerSponsorship: [ [flagger, target], [voter] ]
                } = await setupSponsorships(contracts, [2, 1], "flag-with-metadata")
                const start = await getBlockTimestamp()
                const signers = await hardhatEthers.getSigners()
                const outsider = signers[5]

                // ...not before flagging
                await expect(sponsorship.connect(outsider).voteOnFlag(target.address, VOTE_KICK))
                    .to.be.revertedWith("error_notFlagged")

                // ...not after flagging
                await advanceToTimestamp(start, "Flagging")
                await expect(flagger.flag(sponsorship.address, target.address, "{}"))
                    .to.emit(voter, "ReviewRequest")
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
