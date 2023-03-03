import { ethers } from "hardhat"
import { BigNumber, utils, Wallet, ContractReceipt } from "ethers"
import { expect } from "chai"

import { deployTestContracts } from "../deployTestContracts"
import { deployBountyContract } from "../deployBountyContract"
import { deployBrokerPool } from "../deployBrokerPool"

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
            const { token, bounty, brokers: [ broker, _, broker3 ], pools: [ pool1, pool2, pool3 ] } = await setup(3, 0, this.test?.title)
            
            await expect(pool1.connect(broker).flag(bounty.address, pool2.address)).to.emit(bounty, "ReviewRequest")
                .withArgs(pool3.address, bounty.address, pool2.address)

            await expect(pool3.connect(broker3).voteOnFlag(bounty.address, pool2.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(pool2.address, parseEther("100"))
            expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))
        })

        it("with 3 voters", async function(): Promise<void> {
            const { token, bounty, brokers: [ broker, _, broker3, broker4, broker5 ],
                pools: [ pool1, flagTarget, pool3, pool4, pool5 ] } = await setup(5, 0, this.test?.title)

            await expect(pool1.connect(broker).flag(bounty.address, flagTarget.address))
                .to.emit(bounty, "ReviewRequest").withArgs(pool3.address, bounty.address, flagTarget.address)
                .to.emit(bounty, "ReviewRequest").withArgs(pool4.address, bounty.address, flagTarget.address)
                .to.emit(bounty, "ReviewRequest").withArgs(pool5.address, bounty.address, flagTarget.address)

            await expect(pool3.connect(broker3).voteOnFlag(bounty.address, flagTarget.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(pool4.connect(broker4).voteOnFlag(bounty.address, flagTarget.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(pool5.connect(broker5).voteOnFlag(bounty.address, flagTarget.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(flagTarget.address, parseEther("100"))
            expect(await token.balanceOf(flagTarget.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(broker3.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(broker4.address)).to.equal(parseEther("0"))
            expect (await token.balanceOf(broker5.address)).to.equal(parseEther("1"))
        })

        it("with 2 flags active at the same time (not interfere with each other)", async function(): Promise<void> {
            const { token, bounty, brokers: [ flagger1, flagger2],
                pools: [ pool1, pool2, target1, target2, voterPool1, voterPool2, voterPool3 ],
                nonStakedBrokers: [voter1, voter2, voter3] } = await setup(4, 3, "2-simultaneous-flags")

            await expect (pool1.connect(flagger1).flag(bounty.address, target1.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool1.address, bounty.address, target1.address)
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool2.address, bounty.address, target1.address)
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool3.address, bounty.address, target1.address)
                .to.emit(bounty, "ReviewRequest").withArgs(pool2.address, bounty.address, target1.address)
                .to.emit(bounty, "ReviewRequest").withArgs(target2.address, bounty.address, target1.address)

            await expect (pool2.connect(flagger2).flag(bounty.address, target2.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool1.address, bounty.address, target2.address)
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool2.address, bounty.address, target2.address)
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool3.address, bounty.address, target2.address)
                .to.emit(bounty, "ReviewRequest").withArgs(pool1.address, bounty.address, target2.address)
                .to.emit(bounty, "ReviewRequest").withArgs(target1.address, bounty.address, target2.address)

            await expect(voterPool1.connect(voter1).voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voterPool2.connect(voter2).voteOnFlag(bounty.address, target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voterPool3.connect(voter3).voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voterPool3.connect(voter3).voteOnFlag(bounty.address, target2.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")
            await expect(voterPool2.connect(voter2).voteOnFlag(bounty.address, target1.address, VOTE_KICK))
                .to.emit(bounty, "BrokerKicked").withArgs(target1.address, parseEther("100"))
            await expect(voterPool1.connect(voter1).voteOnFlag(bounty.address, target2.address, VOTE_KICK))
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
            const { bounty, brokers, pools: [ pool1, flaggedPool,,, p4, p5, p6, p7] } = await setup(4, 4, "pick-first-nonstaked-brokers")
            
            await expect (pool1.connect(brokers[0]).flag(bounty.address, flaggedPool.address))
                .to.emit(bounty, "ReviewRequest").withArgs(p4.address, bounty.address, flaggedPool.address)
                .to.emit(bounty, "ReviewRequest").withArgs(p5.address, bounty.address, flaggedPool.address)
                .to.emit(bounty, "ReviewRequest").withArgs(p6.address, bounty.address, flaggedPool.address)
                .to.emit(bounty, "ReviewRequest").withArgs(p7.address, bounty.address, flaggedPool.address)
                
        })

        it("does NOT allow to flag with a too small flagstakes", async function(): Promise<void> {
            // TODO
        })

        it("does NOT allow to flag a broker that is already flagged", async function(): Promise<void> {
            // TODO
        })

        it("does NOT allow to flag a broker that is not in the bounty", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], pools: [ flaggerPool,,, notStakedPool ] } = await defaultSetup
            await expect(flaggerPool.connect(flagger).flag(bounty.address, notStakedPool.address))
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
            const { token, bounty, brokers: [ flagger, _, voter, nonVoter ], pools: [ flaggerPool, flagTarget, voterPool ] } = await setup(4)

            await (await flaggerPool.connect(flagger).flag(bounty.address, flagTarget.address)).wait()

            await expect(voterPool.connect(voter).voteOnFlag(bounty.address, flagTarget.address, VOTE_KICK))
                .to.not.emit(bounty, "BrokerKicked")

            await(await flaggerPool.connect(flagger).cancelFlag(bounty.address, flagTarget.address)).wait()
            // expect(await token.balanceOf(pool2.address)).to.equal(parseEther("900"))

            expect (await token.balanceOf(voter.address)).to.equal(parseEther("1"))
            expect (await token.balanceOf(nonVoter.address)).to.equal(parseEther("0"))
            // expect (await token.balanceOf(broker5.address)).to.equal(parseEther("1"))
        })
    })

    describe("Committed stake", (): void => {
        it("allows the target to get out the correct amount of stake DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ],
                pools: [ flaggerPool, targetPool, voterPool] } = await setup(2, 1, this.currentTest?.title)

            await expect(flaggerPool.connect(flagger).flag(bounty.address, targetPool.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool.address, bounty.address, targetPool.address)

            await expect(targetPool.reduceStake(bounty.address, parseEther("901")))
                .to.be.revertedWith("error_cannotReduceStake")
            await expect(targetPool.reduceStake(bounty.address, parseEther("900")))
                .to.emit(bounty, "StakeUpdate").withArgs(targetPool.address, parseEther("100"), parseEther("0"))
        })

        it("allows the target to withdraw the correct amount AFTER the flag period (not kicked)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ],
                pools: [ flaggerPool, targetPool, voterPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, this.currentTest?.title)

            await expect(flaggerPool.connect(flagger).flag(bounty.address, targetPool.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool.address, bounty.address, targetPool.address)

            await expect(voterPool.connect(voter1).voteOnFlag(bounty. address, targetPool.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")

            await expect(targetPool.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(targetPool.address, parseEther("1000"))
        })

        it("allows the flagger to withdraw the correct amount DURING the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ], pools: [ flaggerPool, targetPool] } = await setup(2, 1, this.currentTest?.title)

            await (await flaggerPool.connect(flagger).flag(bounty.address, targetPool.address)).wait() as ContractReceipt

            await expect(flaggerPool.reduceStake(bounty.address, parseEther("991")))
                .to.be.revertedWith("error_cannotReduceStake")
            await expect(flaggerPool.reduceStake(bounty.address, parseEther("990")))
                .to.emit(bounty, "StakeUpdate").withArgs(flaggerPool.address, parseEther("10"), parseEther("0"))
        })

        it("allows the flagger to withdraw the correct amount AFTER the flag period (stake-commited)", async function(): Promise<void> {
            const { bounty, brokers: [ flagger ],
                pools: [ flaggerPool, targetPool, voterPool],
                nonStakedBrokers: [voter1] } = await setup(2, 1, this.currentTest?.title)

            await expect(flaggerPool.connect(flagger).flag(bounty.address, targetPool.address))
                .to.emit(bounty, "ReviewRequest").withArgs(voterPool.address, bounty.address, targetPool.address)

            await expect(voterPool.connect(voter1).voteOnFlag(bounty.address, targetPool.address, VOTE_CANCEL))
                .to.not.emit(bounty, "BrokerKicked")

            await expect(flaggerPool.unstake(bounty.address, "0"))
                .to.emit(bounty, "BrokerLeft").withArgs(flaggerPool.address, parseEther("990"))
        })

        it("does NOT allow the flagger to flag if he has not enough uncommitted stake", async function(): Promise<void> {
            // TODO
        })
    })
})