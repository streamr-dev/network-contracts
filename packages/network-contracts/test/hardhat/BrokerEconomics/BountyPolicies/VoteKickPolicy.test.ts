import { ethers } from "hardhat"
import { BigNumber, utils, Wallet } from "ethers"
import { expect } from "chai"

import { deployPoolFactory, deployTestContracts, TestContracts } from "../deployTestContracts"
import { deployBounty } from "../deployBounty"
import { deployBrokerPool } from "../deployBrokerPool"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"

const { parseEther, id, getAddress, hexZeroPad } = utils

const VOTE_KICK    = "0x0000000000000000000000000000000000000000000000000000000000000001"
const VOTE_NO_KICK = "0x0000000000000000000000000000000000000000000000000000000000000000"
const VOTE_START = 24 * 60 * 60 // 1 day
const VOTE_END = VOTE_START + 60 * 60 // +1 hour

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

describe("VoteKickPolicy", (): void => {

    // default setup for test cases that don't need a clean set of contracts
    // clean setup is needed when review selection has to be controlled (so that BrokerPools from old tests don't interfere)
    let defaultSetup: any
    let contracts: TestContracts
    before(async (): Promise<void> => {
        const signers = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(signers[0])
        for (const { address } of signers) {
            await (await contracts.token.mint(address, parseEther("1000000"))).wait()
        }
        defaultSetup = await setup(3, 2, "default-setup")
    })

    /**
     * Sets up a Bounty and given number of brokers, each with BrokerPool that stakes 1000 tokens into the Bounty
     */
    async function setup(stakedBrokerCount = 3, nonStakedBrokerCount = 0, saltSeed: string, {
        bountySettings = {},
        stakeAmountWei = parseEther("1000"),
    }: {
        bountySettings?: any
        stakeAmountWei?: BigNumber
    } = {}) {
        // Hardhat provides 20 pre-funded signers
        const [admin, ...hardhatSigners] = await ethers.getSigners() as unknown as Wallet[]
        const signers = hardhatSigners.slice(0, stakedBrokerCount + nonStakedBrokerCount)

        // clean deployer wallet starts from nothing => needs ether to deploy BrokerPool etc.
        const deployer = new Wallet(id(saltSeed), admin.provider) // id turns string into bytes32
        await (await admin.sendTransaction({ to: deployer.address, value: parseEther("1") })).wait()
        // console.log("deployer: %s", addr(deployer))

        // we just want to re-deploy the BrokerPoolFactory (not all the policies or BountyFactory)
        // to generate deterministic BrokerPool addresses => deterministic reviewer selection
        const newContracts = {
            ...contracts,
            ...await deployPoolFactory(contracts, deployer)
        }
        // console.log("poolFactory: %s", addr(newContracts.poolFactory))
        // console.log("poolTemplate: %s", addr(newContracts.poolTemplate))
        const { token } = contracts

        // no risk of nonce collisions in Promise.all since each broker has their own separate nonce
        // see BrokerPoolFactory:_deployBrokerPool for how saltSeed is used in CREATE2
        const pools = await Promise.all(signers.map((signer) => deployBrokerPool(newContracts, signer, {}, saltSeed)))
        const staked = pools.slice(0, stakedBrokerCount)
        const nonStaked = pools.slice(stakedBrokerCount, stakedBrokerCount + nonStakedBrokerCount)
        // console.log("signers: %s", signers.map(addr).join(", "))
        // console.log("pools: %s", pools.map(addr).join(", "))

        await Promise.all(signers.map(((signer, i) => token.connect(signer).transferAndCall(pools[i].address, stakeAmountWei, "0x"))))

        const rewardsBeneficiaries = pools.map((pool, i) => getAddress(pool.address.toLowerCase().slice(0, -8) + ("0000000" + i).slice(-8)))
        await Promise.all(pools.map((p, i) => p.setReviewRewardsBeneficiary(rewardsBeneficiaries[i])))

        const bounty = await deployBounty(contracts, {
            allocationWeiPerSecond: BigNumber.from(0),
            penaltyPeriodSeconds: 0,
            brokerPoolOnly: true,
            ...bountySettings
        })
        await bounty.sponsor(parseEther("10000"))

        await Promise.all(staked.map((p) => p.stake(bounty.address, stakeAmountWei)))

        return {
            token,
            bounty,
            staked,
            nonStaked,
            rewardsBeneficiaries,
        }
    }

    describe("Flagging + voting + resolution (happy path)", (): void => {
        it("with one flagger, one target and one voter", async function(): Promise<void> {
            const {
                token, bounty,
                staked: [ flagger, target, voter ]
            } = await setup(3, 0, this.test!.title)
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START + 10, `${addr(flagger)} votes to kick ${addr(target)}`)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target.address, parseEther("100"))

            expect(await token.balanceOf(target.address)).to.equal(parseEther("900")) // slash 10%
        })

        it("with 3 voters", async function(): Promise<void> {
            const {
                token, bounty, rewardsBeneficiaries,
                staked: [ flagger, target, voter1, voter2, voter3 ]
            } = await setup(5, 0, "3-voters-test")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter1, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(voter2, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(voter3, "ReviewRequest").withArgs(bounty.address, target.address)
            await advanceToTimestamp(start + VOTE_START + 10, `votes to kick ${addr(target)}`)
            await expect(voter1.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter2.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voter3.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target.address, parseEther("100"))
            expect(await token.balanceOf(target.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(rewardsBeneficiaries[2])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[3])).to.equal(parseEther("0"))
            expect (await token.balanceOf(rewardsBeneficiaries[4])).to.equal(parseEther("1"))
        })

        it("with 2 flags active at the same time (not interfere with each other)", async function(): Promise<void> {
            const {
                token, bounty, rewardsBeneficiaries,
                staked: [ flagger1, flagger2, target1, target2 ],
                nonStaked: [ voter ],
            } = await setup(4, 1, "2-active-flags")
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

            await advanceToTimestamp(start + VOTE_START + 10, `votes to kick ${addr(target1)} and ${addr(target2)}`)
            await expect(flagger2.voteOnFlag(bounty.address, target1.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")
            await expect(flagger1.voteOnFlag(bounty.address, target2.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")
            await expect(voter.voteOnFlag(bounty.address, target1.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")
            await expect(voter.voteOnFlag(bounty.address, target2.address, VOTE_KICK)).to.not.emit(bounty, "BrokerKicked")

            await expect(target2.voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target1.address, parseEther("100"))
            await expect(target1.voteOnFlag(bounty.address, target2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target2.address, parseEther("100"))

            // slashing happens to pools
            expect(await token.balanceOf(target1.address)).to.equal(parseEther("900"))
            expect(await token.balanceOf(target2.address)).to.equal(parseEther("900"))

            // rewards go to brokers
            expect (await token.balanceOf(rewardsBeneficiaries[0])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[1])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[2])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[3])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[4])).to.equal(parseEther("2")) // voter
        })
    })

    describe("Flagging + reviewer selection", function(): void {
        it("picks first brokers that are not in the same bounty", async () => {
            const {
                bounty,
                staked: [ flagger, target ],
                nonStaked: [ p4, p5, p6, p7 ]
            } = await setup(5, 4, "pick-first-nonstaked-brokers")

            // all 4 brokers that are not in the same bounty get picked; additionally 1 more from same bounty randomly (but not more!)
            await expect (flagger.flag(bounty.address, target.address))
                .to.emit(p4, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(p5, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(p6, "ReviewRequest").withArgs(bounty.address, target.address)
                .to.emit(p7, "ReviewRequest").withArgs(bounty.address, target.address)
        })

        it("can NOT flag if not enough stake", async function(): Promise<void> {
            // TODO: error_notEnoughStake
        })

        it("can NOT flag a broker that is already flagged", async function(): Promise<void> {
            // TODO:
        })

        it("does NOT allow to flag a broker that is not in the bounty", async function(): Promise<void> {
            const { bounty, staked: [ flagger ], nonStaked: [ notStakedPool ] } = await defaultSetup
            await expect(flagger.flag(bounty.address, notStakedPool.address))
                .to.be.revertedWith("error_flagTargetNotStaked")
        })
    })

    describe("Flag resolution", function(): void {
        it("cleans up all the values correctly after a flag (successive flags with same flagger and target)", async function(): Promise<void> {
            // TODO
        })

        it("results in NO_KICK if no one voted", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target ] } = defaultSetup
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(bounty.address, target.address)).wait()

            // attempting to vote actually ends the vote because voting period is over
            await advanceToTimestamp(start + VOTE_END + 10, "End vote")
            expect(await bounty.getFlag(target.address)).to.not.equal("0") // open
            await (await target.voteOnFlag(bounty.address, target.address, VOTE_KICK)).wait()
            expect(await bounty.getFlag(target.address)).to.equal("0") // closed

            // target is not kicked
            expect(await bounty.getStake(target.address)).to.not.equal("0")
        })

        it("prevents immediately flagging the same broker again after NO_KICK result", async function(): Promise<void> {
            // TODO: error_cannotFlagAgain
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger already was kicked", async function(): Promise<void> {
            const {
                token, bounty, rewardsBeneficiaries,
                staked: [ flagger, target ],
                nonStaked: voters
            } = await setup(2, 5, "flagger-had-been-kicked")
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

            expect (await token.balanceOf(rewardsBeneficiaries[2])).to.equal(parseEther("2"))
            expect (await token.balanceOf(rewardsBeneficiaries[3])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[4])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[5])).to.equal(parseEther("2"))
            expect (await token.balanceOf(rewardsBeneficiaries[6])).to.equal(parseEther("2"))
        })

        it("pays reviewers who correctly voted NO_KICK even if flagger already forceUnstaked", async function(): Promise<void> {
            const {
                token, bounty, rewardsBeneficiaries,
                staked: [ flagger, target ],
                nonStaked: voters
            } = await setup(2, 5, "forceUnstaked-flagger")
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

            expect (await token.balanceOf(rewardsBeneficiaries[2])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[3])).to.equal(parseEther("0"))
            expect (await token.balanceOf(rewardsBeneficiaries[4])).to.equal(parseEther("0"))
            expect (await token.balanceOf(rewardsBeneficiaries[5])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[6])).to.equal(parseEther("1"))

            expect(flaggerBalanceBefore).to.equal("0")
            expect(flaggerBalanceAfter).to.equal(parseEther("990")) // flag-stake was forfeited
        })

        it("pays reviewers who correctly voted KICK even if target already forceUnstaked", async function(): Promise<void> {
            const {
                token, bounty, rewardsBeneficiaries,
                staked: [ flagger, target ],
                nonStaked: voters
            } = await setup(2, 5, "target-forceUnstake")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await (await flagger.flag(bounty.address, target.address)).wait()

            await advanceToTimestamp(start + 10, `${addr(target)} forceUnstakes`)
            const targetBalanceBefore = await token.balanceOf(target.address)
            await expect(target.unstake(bounty.address, "1")).to.be.revertedWith("error_activeFlag")
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

            expect (await token.balanceOf(rewardsBeneficiaries[2])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[3])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[4])).to.equal(parseEther("1"))
            expect (await token.balanceOf(rewardsBeneficiaries[5])).to.equal(parseEther("0"))
            expect (await token.balanceOf(rewardsBeneficiaries[6])).to.equal(parseEther("0"))

            expect(targetBalanceBefore).to.equal("0")
            expect(targetBalanceAfter).to.equal(parseEther("900")) // 10% stake was forfeited
        })

        it("can be called by anyone if the flagger was kicked (and pays everyone correctly)", async function(): Promise<void> {

        })
    })

    describe("Voting timeline", function(): void {
        it("NO voting before the voting starts", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target ], nonStaked: [ voter ] } = await setup(2, 1, "voting-timeline")
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_votingNotStarted")
        })

        it("voting resolution can be triggered by anyone after the voting period is over", async function(): Promise<void> {
        })
    })

    describe("Committed stake", (): void => {
        it("allows the target to get out the correct amount of stake DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target ], nonStaked: [ voter ] } = await setup(2, 1, "target-reducestake")

            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            const minimumStake = await bounty.minimumStakeOf(target.address)
            expect(minimumStake).to.equal(parseEther("100"))
            await expect(target.reduceStakeTo(bounty.address, parseEther("99")))
                .to.be.revertedWith("error_minimumStake")
            await expect(target.reduceStakeTo(bounty.address, parseEther("100")))
                .to.emit(bounty, "StakeUpdate").withArgs(target.address, parseEther("100"), parseEther("0"))
        })

        it("allows the target to withdraw the correct amount AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target ], nonStaked: [ voter ] } = await setup(2, 1, "target-after-flag")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START + 10, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(bounty. address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            await expect(target.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(target.address, parseEther("1000"))
        })

        it("allows the flagger to withdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target ], nonStaked: [ voter ] } = await setup(2, 1, "flagger-reducestake")

            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            const minimumStake = await bounty.minimumStakeOf(flagger.address)
            expect(minimumStake).to.equal(parseEther("10"))
            await expect(flagger.reduceStakeTo(bounty.address, parseEther("9")))
                .to.be.revertedWith("error_minimumStake")
            await expect(flagger.reduceStakeTo(bounty.address, parseEther("10")))
                .to.emit(bounty, "StakeUpdate").withArgs(flagger.address, parseEther("10"), parseEther("0"))
        })

        it("allows the flagger to withdraw all their stake AFTER the flag resolves to NO_KICK", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target ], nonStaked: [ voter ] } = await setup(2, 1, "flagger-after-flag")
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START + 10, `${addr(voter)} votes`)
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            await expect(flagger.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(flagger.address, parseEther("999"))
        })

        it("does NOT allow the flagger to flag if he has not enough uncommitted stake", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target, target2 ]} = await setup(3, 0, "flagger-after-flag", {
                stakeAmountWei: parseEther("20"), // enough for 2 flag-stakes
            })
            await expect(flagger.flag(bounty.address, target.address)).to.emit(target2, "ReviewRequest")
            await expect(flagger.flag(bounty.address, target2.address)).to.be.rejectedWith("error_notEnoughStake")
        })

        it("does NOT allow the flagger to flag if his stake has been slashed below minimum stake", async function(): Promise<void> {
            const { bounty, staked: [ flagger, target, voter ]} = await setup(3, 0, "flagger-after-flag", {
                stakeAmountWei: parseEther("20"),
                bountySettings: {
                    minimumStakeWei: parseEther("19.5"),
                }
            })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, `${addr(flagger)} flags ${addr(target)}`)
            await expect(flagger.flag(bounty.address, target.address)).to.emit(voter, "ReviewRequest")

            await advanceToTimestamp(start + VOTE_START + 10, `${addr(voter)} votes`)
            await (await voter.voteOnFlag(bounty.address, target.address, VOTE_NO_KICK)).wait()
            expect(await bounty.getFlag(target.address)).to.equal("0") // flag is resolved

            expect(await bounty.getStake(flagger.address)).to.equal(parseEther("19"))

            await advanceToTimestamp(start + VOTE_START + 1000, `${addr(flagger)} tries to flag ${addr(voter)}`)
            await expect(flagger.flag(bounty.address, voter.address)).to.be.rejectedWith("error_notEnoughStake")
        })

        it("ensures enough tokens to pay reviewers if flagger reduces stake to minimum then gets kicked", async function(): Promise<void> {
            // joins
            // raises as many as flags as they can: 90% of stake committed
            // reduces stake as much as they can: nothing I guess?
            // gets kicked
            // all flags become NO_KICK, reviewers get paid
        })
    })
})
