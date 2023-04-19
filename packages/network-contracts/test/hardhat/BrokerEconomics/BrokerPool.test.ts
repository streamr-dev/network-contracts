import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp, VOTE_KICK, VOTE_START } from "./utils"
import { deployBrokerPool } from "./deployBrokerPool"

import { deployBounty } from "./deployBounty"
import { IKickPolicy } from "../../../typechain"
import { setupBounties } from "./setupBounty"

const { parseEther, formatEther, hexZeroPad } = utils
const { getSigners, getContractFactory } = hardhatEthers

describe("BrokerPool", (): void => {
    let admin: Wallet       // creates the Bounty
    let sponsor: Wallet     // sponsors the Bounty
    let broker: Wallet      // creates pool
    let delegator: Wallet   // puts DATA into pool
    let delegator2: Wallet
    let delegator3: Wallet

    // many tests don't need their own clean set of contracts that take time to deploy
    let sharedContracts: TestContracts
    let testKickPolicy: IKickPolicy

    // burn all tokens then mint the corrent amount of new ones
    async function setTokens(account: Wallet, amount: string) {
        const { token } = sharedContracts
        const oldBalance = await token.balanceOf(account.address)
        await (await token.connect(account).transfer("0x1234000000000000000000000000000000000000", oldBalance)).wait()
        if (amount !== "0") {
            await (await token.mint(account.address, parseEther(amount))).wait()
        }
    }

    before(async (): Promise<void> => {
        [admin, sponsor, broker, delegator, delegator2, delegator3] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(admin)

        testKickPolicy = await (await (await getContractFactory("TestKickPolicy", admin)).deploy()).deployed() as unknown as IKickPolicy
        await (await sharedContracts.bountyFactory.addTrustedPolicies([ testKickPolicy.address])).wait()
    })

    it("allows delegate and undelegate", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(delegator).delegate(parseEther("1000")))
            .to.emit(pool, "Delegated").withArgs(delegator.address, parseEther("1000"))
        const freeFundsAfterdelegate = await token.balanceOf(pool.address)

        await expect(pool.connect(delegator).undelegate(parseEther("1000")))
            .to.emit(pool, "Undelegated").withArgs(delegator.address, parseEther("1000"))
        const freeFundsAfterUndelegate = await token.balanceOf(pool.address)

        expect(formatEther(freeFundsAfterdelegate)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterUndelegate)).to.equal("0.0")
    })

    it("allows delegate, transfer of poolTokens, and undelegate by another delegator", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(delegator).delegate(parseEther("1000")))
            .to.emit(pool, "Delegated").withArgs(delegator.address, parseEther("1000"))
        const freeFundsAfterdelegate = await token.balanceOf(pool.address)

        await (await pool.connect(delegator).transfer(delegator2.address, parseEther("1000"))).wait()

        await expect(pool.connect(delegator2).undelegate(parseEther("1000")))
            .to.emit(pool, "Undelegated").withArgs(delegator2.address, parseEther("1000"))
        const freeFundsAfterUndelegate = await token.balanceOf(pool.address)

        expect(formatEther(freeFundsAfterdelegate)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterUndelegate)).to.equal("0.0")
    })

    it("stakes, and unstakes with gains", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "1000")
        const bounty = await deployBounty(sharedContracts)
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const balanceBefore = await token.balanceOf(pool.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "Unstake from bounty")
        await expect(pool.unstake(bounty.address))
            .to.emit(pool, "Unstaked").withArgs(bounty.address, parseEther("1000"), parseEther("1000"))

        const gains = (await token.balanceOf(pool.address)).sub(balanceBefore)
        expect(formatEther(gains)).to.equal("800.0") // 200 broker fee
    })

    describe("DefaultPoolJoinPolicy", () => {
        before(async () => {
            await setTokens(broker, "3000")
            await setTokens(delegator, "15000")
        })
        it("negativetest minbrokerstakepercent, cannot join when brokers stake too small", async function(): Promise<void> {
            const { token } = sharedContracts
            const pool = await deployBrokerPool(sharedContracts, broker, { minBrokerStakePercent: 10 })
            // broker should have 111.2 pool tokens, but has nothing
            await expect(token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x"))
                .to.be.revertedWith("error_joinPolicyFailed")
        })

        it("negativetest minbrokerstakepercent, delegator can't join if the broker's stake would fall too low", async function(): Promise<void> {
            const { token } = sharedContracts
            const pool = await deployBrokerPool(sharedContracts, broker, { minBrokerStakePercent: 10 })
            await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("10000"), "0x")).wait()
            await expect(token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x"))
                .to.be.revertedWith("error_joinPolicyFailed")
        })

        it("positivetest minbrokerstakepercent, can join", async function(): Promise<void> {
            const { token } = sharedContracts
            const pool = await deployBrokerPool(sharedContracts, broker, { minBrokerStakePercent: 10 })
            await (await token.connect(broker).transferAndCall(pool.address, parseEther("113"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        })
    })

    it("updates approximate pool value when updateApproximatePoolvalueOfBounty is called", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(sponsor, "1000")
        await setTokens(broker, "1000")
        const pool = await deployBrokerPool(sharedContracts, broker)
        const bounty = await deployBounty(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await (await pool.stake(bounty.address, parseEther("1000"))).wait()

        // some time passes => approx poolvalue differs from real poolvalue
        await advanceToTimestamp(timeAtStart + 1001, "Read the earnings back to BrokerPool")

        const approxPoolValueBefore = await pool.getApproximatePoolValue()
        const actualPoolValueBefore = await pool.calculatePoolValueInData()
        const poolValuePerBountyBefore = await pool.getApproximatePoolValuesPerBounty()

        await (await pool.updateApproximatePoolvalueOfBounty(bounty.address)).wait()

        const approxPoolValueAfter = await pool.getApproximatePoolValue()
        const actualPoolValueAfter = await pool.calculatePoolValueInData()
        const poolValuePerBountyAfter = await pool.getApproximatePoolValuesPerBounty()

        expect(formatEther(approxPoolValueBefore)).to.equal("1000.0")
        expect(formatEther(actualPoolValueBefore)).to.equal("2000.0")
        expect(formatEther(poolValuePerBountyBefore.approxValues[0])).to.equal("1000.0")
        expect(formatEther(poolValuePerBountyBefore.realValues[0])).to.equal("2000.0")
        expect(poolValuePerBountyBefore.bountyAddresses[0]).to.equal(bounty.address)

        expect(formatEther(approxPoolValueAfter)).to.equal("2000.0")
        expect(formatEther(actualPoolValueAfter)).to.equal("2000.0")
        expect(formatEther(poolValuePerBountyAfter.approxValues[0])).to.equal("2000.0")
        expect(formatEther(poolValuePerBountyAfter.realValues[0])).to.equal("2000.0")
        expect(poolValuePerBountyAfter.bountyAddresses[0]).to.equal(bounty.address)
    })

    it("tries to keep the maintenance margin, diverts all of broker's share", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(sponsor, "1000")
        await setTokens(broker, "1000")
        await setTokens(delegator, "1000")
        const bounty = await deployBounty(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const pool = await deployBrokerPool(sharedContracts, broker, {
            maintenanceMarginPercent: 20,
            maxBrokerDivertPercent: 100,
            brokerSharePercent: 20
        })
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("100"), "0x")).wait()
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("900"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        const brokersDataBefore = await token.balanceOf(broker.address)

        // broker staked 100 DATA so they should have 100 BrokerPool tokens
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("100.0")

        await advanceToTimestamp(timeAtStart + 500, "Withdraw earnings from bounty")
        await pool.withdrawEarningsFromBounty(bounty.address)
        expect(await token.balanceOf(pool.address)).to.equal(parseEther("500"))

        // despite brokerSharePercent=20%, broker should not have more DATA since 1000 of his earnings are staked (left in pool)
        const brokersDataAfter = await token.balanceOf(broker.address)
        expect(brokersDataAfter).to.equal(brokersDataBefore)

        // broker's share of (500 * 20% = 100) DATA are added to the pool and minted for the broker
        // exchange rate is 1 pool token / DATA like it was before the withdraw
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("200.0")
        // TODO: add getter for the "margin" (and rename it?), test for it directly
    })

    it("keeps the maintenance margin, diverts enough of broker's share to reach maintenanceMarginPercent", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts
        await setTokens(sponsor, "1000")
        await setTokens(broker, "1000")
        await setTokens(delegator, "1000")
        const bounty = await deployBounty(sharedContracts)
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const pool = await deployBrokerPool(sharedContracts, broker, {
            maintenanceMarginPercent: 50,
            maxBrokerDivertPercent: 100,
            brokerSharePercent: 20
        })
        await (await dataToken.connect(broker).transferAndCall(pool.address, parseEther("100"), "0x")).wait()
        await (await dataToken.connect(delegator).transferAndCall(pool.address, parseEther("300"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("100"))
        await expect(pool.stake(bounty.address, parseEther("400")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("400"))
        await advanceToTimestamp(timeAtStart + 5000, "get gains")
        await pool.withdrawEarningsFromBounty(bounty.address)

        // broker had 100 of 400 PT, 25% but needs 50% to reach maintenance margin
        // so DATA worth 200 PT are diverted and minted for the broker
        // then he has 300 of 600 PT, 50%
        expect(await pool.totalSupply()).to.equal(parseEther("600"))
        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("300"))
    })

    // https://hackmd.io/QFmCXi8oT_SMeQ111qe6LQ
    it("revenue sharing scenarios 1..7: happy path pool life cycle", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts

        // Setup:
        // - There is one single delegator with funds of 1000 DATA and no delegations.
        await (await dataToken.connect(delegator).transfer(admin.address, await dataToken.balanceOf(delegator.address))).wait() // burn all tokens
        await (await dataToken.connect(broker).transfer(admin.address, await dataToken.balanceOf(broker.address))).wait() // burn all tokens
        await (await dataToken.mint(delegator.address, parseEther("1000"))).wait()
        await (await dataToken.mint(sponsor.address, parseEther("2500"))).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 }) // policy needed in part 4

        // 1: Simple Join/Delegate
        // "There is a maximum allocation policy of 500 DATA in this system." not implemented => simulate by only delegating 5 DATA
        await (await dataToken.connect(delegator).transferAndCall(pool.address, parseEther("500"), "0x")).wait()

        expect(await pool.connect(delegator).getMyBalanceInData()).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("500"))
        expect(await pool.totalSupply()).to.equal(parseEther("500"))

        // Setup for 2: sponsorship must be only 25 so at #6, Unstaked returns earnings=0
        const bounty = await deployBounty(sharedContracts)
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("2500"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        // 2: Simple Staking
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("500")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("500"))

        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await dataToken.balanceOf(bounty.address)).to.equal(parseEther("3000")) // 2500 sponsorship + 500 stake
        expect(await pool.getPoolValueFromBounty(bounty.address)).to.equal(parseEther("500"))
        expect(await bounty.stakedWei(pool.address)).to.equal(parseEther("500"))
        expect(await bounty.getEarnings(pool.address)).to.equal(parseEther("0"))

        // 3: Yield Allocated to Accounts
        // Skip this: there is no yield allocation policy that sends incoming earnings directly to delegators

        // 4: Yield Allocated to Pool Value
        await advanceToTimestamp(timeAtStart + 10000, "Withdraw from bounty") // bounty only has 25 DATA sponsorship, so that's what it will allocate
        await (await pool.withdrawEarningsFromBounty(bounty.address)).wait()
        // TODO: add event to BrokerPool
        // await expect(pool.withdrawEarningsFromBounty(bounty.address))
        //    .to.emit(pool, "Withdrawn").withArgs(bounty.address, parseEther("2500"))

        expect(await dataToken.balanceOf(broker.address)).to.equal(parseEther("500"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("2500"))
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("2000"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("500"))

        // 5: Withdraw
        // Because the pool value is equal to 25 and the number of pool tokens is equal to 5, the exchange rate is 25/5.
        // This values each pool token as being worth 5 data.
        // Because there is 20 in terms of funds that is available currently, that is the amount of DATA which will be paid out.
        // 20 DATA / 5 Exchange Rate = 4 Pool Tokens are paid out, 1 pool token payout is put into the queue.
        await expect(pool.connect(delegator).undelegate(parseEther("500")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("500"))
            .to.emit(pool, "Undelegated").withArgs(delegator.address, parseEther("2000"))
            .to.emit(pool, "QueueUpdated").withArgs(delegator.address, parseEther("100"))

        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("2500")) // +20
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("100"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("100"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("100"))

        // 6: Pay out the queue by unstaking
        await expect(pool.unstake(bounty.address))
            .to.emit(pool, "Unstaked").withArgs(bounty.address, parseEther("500"), parseEther("0"))
            .to.emit(pool, "Undelegated").withArgs(delegator.address, parseEther("500"))
            .to.not.emit(pool, "Losses")

        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("0"))
        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("3000")) // +5
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("0"))
        expect(await pool.queueIsEmpty()).to.equal(true)

        // 7: skip, too similar to cases 4+5
    })

    it.skip("revenue sharing scenarios 8..10: slashing", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts
        await (await dataToken.connect(delegator).transfer(admin.address, await dataToken.balanceOf(delegator.address))).wait() // burn all tokens
        await (await dataToken.connect(broker).transfer(admin.address, await dataToken.balanceOf(broker.address))).wait() // burn all tokens
        await (await dataToken.mint(delegator.address, parseEther("10"))).wait()

        // Setup:
        // - There is one bounty
        // - There is one pool that has staked 5 DATA into the bounty
        // - There is one delegator (with 5 DATA) who has staked 5 DATA into the pool (has 5 pool tokens)
        const bounty = await deployBounty(sharedContracts)
        // await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("25"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 }) // policy needed in part 4
        await (await dataToken.connect(delegator).transferAndCall(pool.address, parseEther("5"), "0x")).wait()
        await expect(pool.stake(bounty.address, parseEther("5")))

        // 8: Slashing
        await expect(bounty.voteOnFlag(pool.address, parseEther("5").toHexString()))
            .to.emit(bounty, "StakeUpdate").withArgs(pool.address, parseEther("0"), parseEther("0"))

        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("5"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("0"))
    })

    it("broker withdraws all of its stake, pool value goes to zero, no one can join anymore", async function(): Promise<void> {
        // TODO
    })

    describe("Undelegation queue", function(): void {

        it("pays out 1 queue entry fully using earnings withdrawn from bounty", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const bounty = await deployBounty(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
            const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
            await expect(pool.stake(bounty.address, parseEther("1000")))
                .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
            await expect(pool.connect(delegator).undelegate(parseEther("100")))
                .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("100"))
            expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("100"))
            expect(await pool.queuePositionOf(delegator.address)).to.equal(1)

            // earnings are 1 token/second * 1000 seconds = 1000, minus 200 broker fee = 800 DATA
            // poolvalue is 1000 stake + 800 earnings = 1800 DATA
            // There are 1000 PoolTokens => exchange rate is 1800 / 1000 = 1.8 DATA/PoolToken
            // delegator should receive a payout: 100 PoolTokens * 1.8 DATA = 180 DATA

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from bounty")
            await expect(pool.withdrawEarningsFromBounty(bounty.address))
            // TODO: add event to BrokerPool
            //    .to.emit(pool, "EarningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
                .to.emit(pool, "Undelegated").withArgs(delegator.address, parseEther("180"))
            //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("180.0")
            expect(formatEther(await token.balanceOf(pool.address))).to.equal("620.0")
        })

        it("pays out 1 queue entry partially using earnings withdrawn from bounty", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "5000")

            const bounty = await deployBounty(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("5000"), "0x")).wait()
            const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 25 })
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
            await expect(pool.stake(bounty.address, parseEther("1000")))
                .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
            await expect(pool.connect(delegator).undelegate(parseEther("1000")))
                .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("1000"))
            expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("1000"))

            // earnings are 2000, minus 500 broker fee = 1500 DATA
            // 1500 DATA will be paid out
            // poolvalue is 1000 stake + 1500 earnings = 2500 DATA
            // There are 1000 PoolTokens => exchange rate is 2500 / 1000 = 2.5 DATA/PoolToken
            // PoolTokens to be burned: 1500 DATA = 1500/2.5 = 600 PoolTokens
            // Left in the queue: 1000 - 600 = 400 PoolTokens
            await advanceToTimestamp(timeAtStart + 2000, "withdraw earnings from bounty")
            await expect(pool.withdrawEarningsFromBounty(bounty.address))
                .to.emit(pool, "Transfer").withArgs(delegator.address, "0x0000000000000000000000000000000000000000", parseEther("600"))
            //    .to.emit(pool, "EarningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
                .to.emit(pool, "Undelegated").withArgs(delegator.address, parseEther("1500"))
            //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))
            expect(formatEther(await pool.totalQueuedPerDelegatorWei(delegator.address))).to.equal("400.0")
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("1500.0")
            expect(formatEther(await token.balanceOf(pool.address))).to.equal("0.0")
        })

        it("pays out multiple queue places, before and after withdrawing earnings from bounty", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const bounty = await deployBounty(sharedContracts)
            const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
            const balanceBefore = await token.balanceOf(delegator.address)
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to bounty")
            await expect(pool.stake(bounty.address, parseEther("1000")))
                .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

            // queue payout
            await pool.connect(delegator).undelegate(parseEther("500"))
            await pool.connect(delegator).undelegate(parseEther("400"))
            expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("900"))
            expect(await pool.queuePositionOf(delegator.address)).to.equal(2)

            await advanceToTimestamp(timeAtStart + 1000, "withdraw earnings from bounty")
            await pool.withdrawEarningsFromBounty(bounty.address)
            // TODO: enable next line
            await pool.connect(delegator).undelegate(parseEther("100"))
            // now queue should have been paid out from earnings
            // should equal balance before - 1000 (stake still staked) + 800 (yield)
            const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("800"))
            const balanceAfter = await token.balanceOf(delegator.address)
            expect(balanceAfter).to.equal(expectedBalance)

            const delegatorQueuedPayoutAfter = await pool.totalQueuedPerDelegatorWei(delegator.address)
            expect(delegatorQueuedPayoutAfter.toString()).to.equal("555555555555555555556")
        })

        it("pays out the remaining pool tokens if the delegator moves some pool tokens away while queueing", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const bounty = await deployBounty(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
            const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
            await expect(pool.stake(bounty.address, parseEther("1000")))
                .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
            await expect(pool.connect(delegator).undelegate(parseEther("600")))
                .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"))
            expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("600"))

            // move pool tokens away, leave only 100 to the delegator; that will be the whole amount of the exit, not 600
            await pool.connect(delegator).transfer(sponsor.address, parseEther("900"))
            expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("600"))
            expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("100"))

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from bounty")
            await expect(pool.withdrawEarningsFromBounty(bounty.address))
            // TODO: add event to BrokerPool
            //    .to.emit(pool, "EarningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
                .to.emit(pool, "Undelegated").withArgs(delegator.address, parseEther("180"))
            //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))

            // earnings are 1000, minus 200 broker fee = 800 DATA
            // poolvalue is 1000 stake + 800 earnings = 1800 DATA
            // There are 1000 PoolTokens => exchange rate is 1800 / 1000 = 1.8 DATA/PoolToken
            // delegator should receive a payout: 100 PoolTokens * 1.8 DATA = 180 DATA
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("180.0")
            expect(formatEther(await token.balanceOf(pool.address))).to.equal("620.0")
        })

        it("pays out nothing if the delegator moves ALL their pool tokens away while queueing", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const bounty = await deployBounty(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
            const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
            await expect(pool.stake(bounty.address, parseEther("1000")))
                .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
            await expect(pool.connect(delegator).undelegate(parseEther("600")))
                .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"))
            expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("600"))

            // move pool tokens away, nothing can be exited, although nominally there's still 600 in the queue
            await pool.connect(delegator).transfer(sponsor.address, parseEther("1000"))
            expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("600"))
            expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("0"))

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from bounty")
            await expect(pool.withdrawEarningsFromBounty(bounty.address))
            // TODO: add event to BrokerPool
            //    .to.emit(pool, "EarningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
                .to.not.emit(pool, "Undelegated")
            //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))

            // earnings are 1000, minus 200 broker fee = 800 DATA
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(pool.address))).to.equal("800.0")
        })

        it("accepts forced takeout from non-broker after grace period is over (negative + positive test)", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const bounty = await deployBounty(sharedContracts)
            const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()
            const gracePeriod = +await pool.maxQueueSeconds()

            await advanceToTimestamp(timeAtStart, "Stake to bounty")
            await expect(pool.stake(bounty.address, parseEther("1000")))
                .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

            await advanceToTimestamp(timeAtStart + 1000, "Queue for undelegation")
            await pool.connect(delegator).undelegate(parseEther("100"))
            const delegatorQueuedPayout = await pool.totalQueuedPerDelegatorWei(delegator.address)
            expect(delegatorQueuedPayout).to.equal(parseEther("100"))

            await advanceToTimestamp(timeAtStart + gracePeriod, "Force unstaking attempt")
            await expect (pool.connect(delegator).forceUnstake(bounty.address, 10)).to.be.revertedWith("error_onlyBroker")

            // now anyone can trigger the unstake and payout of the queue
            await advanceToTimestamp(timeAtStart + 2000 + gracePeriod, "Force unstaking")
            await (await pool.connect(delegator).forceUnstake(bounty.address, 10)).wait()

            // 1000 were staked, 1000 are earnings, 200 is broker's share, so pool gets 800 DATA
            //   => with 1000 PT existing, value of 1 PT is 1.8 DATA,
            //   => the 100 queued PT will pay out 180 DATA
            const balanceAfter = await token.balanceOf(delegator.address)

            expect(formatEther(balanceAfter)).to.equal("180.0")
        })
    })

    // https://hackmd.io/Tmrj2OPLQwerMQCs_6yvMg
    it("forced example scenario", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.connect(delegator2).transfer(admin.address, await token.balanceOf(delegator2.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("100"))).wait()
        await (await token.mint(delegator2.address, parseEther("100"))).wait()
        await (await token.mint(delegator3.address, parseEther("100"))).wait()

        const days = 24 * 60 * 60
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("100"), "0x")).wait()
        await (await token.connect(delegator2).transferAndCall(pool.address, parseEther("100"), "0x")).wait()
        await (await token.connect(delegator3).transferAndCall(pool.address, parseEther("100"), "0x")).wait()

        const bounty1 = await deployBounty(sharedContracts)
        const bounty2 = await deployBounty(sharedContracts)
        await pool.stake(bounty1.address, parseEther("200"))
        await pool.stake(bounty2.address, parseEther("100"))

        const timeAtStart = await getBlockTimestamp()

        // Starting state
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("100"))
        expect(await pool.balanceOf(delegator2.address)).to.equal(parseEther("100"))
        expect(await pool.balanceOf(delegator3.address)).to.equal(parseEther("100"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("300"))
        expect(await token.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await pool.queueIsEmpty()).to.equal(true)

        await advanceToTimestamp(timeAtStart + 0*days, "Delegator 1 enters the exit queue")
        await pool.connect(delegator).undelegate(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 5*days, "Delegator 2 enters the exit queue")
        await pool.connect(delegator2).undelegate(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 29*days, "Delegator 1 wants to force-unstake too early")
        await expect(pool.connect(delegator).forceUnstake(bounty1.address, 100)).to.be.revertedWith("error_onlyBroker")

        await advanceToTimestamp(timeAtStart + 31*days, "Broker unstakes 5 data from bounty1")
        await pool.reduceStakeTo(bounty1.address, parseEther("150"))

        // bounty1 has 15 stake left, bounty2 has 10 stake left
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("50"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("250"))

        // now anyone can trigger the unstake and payout of the queue
        // await (await pool.updateApproximatePoolvalueOfBounty(bounty2.address)).wait()
        // await (await pool.updateApproximatePoolvalueOfBounty(bounty1.address)).wait()
        await expect(pool.connect(delegator2).forceUnstake(bounty1.address, 10))
            .to.emit(pool, "Unstaked").withArgs(bounty1.address, parseEther("150"), parseEther("0"))

        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(delegator2.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(delegator3.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator2.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator3.address)).to.equal(parseEther("100"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("100"))
        expect(await pool.queueIsEmpty()).to.equal(true)
    })

    it("edge case many queue entries, one bounty", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "1000")

        const bounty = await deployBounty(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const pool = await deployBrokerPool(sharedContracts, broker)
        const balanceBefore = await token.balanceOf(delegator.address)
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        // await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        const numberOfQueueSlots = 2
        for (let i = 0; i < numberOfQueueSlots; i++) {
            await pool.connect(delegator).undelegate(parseEther("1"))
        }
        const delegatorQueuedPayout = await pool.totalQueuedPerDelegatorWei(delegator.address)
        expect(delegatorQueuedPayout).to.equal(parseEther(numberOfQueueSlots.toString()))

        await pool.unstake(bounty.address, { gasLimit: 0xF42400 })

        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther(numberOfQueueSlots.toString()))
        const balanceAfter = await token.balanceOf(delegator.address)
        expect(balanceAfter).to.equal(expectedBalance)
    })

    it("punishes broker on too much diff on approx poolvalue", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(broker, "1000")
        await setTokens(delegator, "0")
        await setTokens(sponsor, "2000")

        const bounty1 = await deployBounty(sharedContracts)
        const bounty2 = await deployBounty(sharedContracts)
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty2.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty1.address, parseEther("500")))
            .to.emit(pool, "Staked").withArgs(bounty1.address, parseEther("500"))
        await expect(pool.stake(bounty2.address, parseEther("500")))
            .to.emit(pool, "Staked").withArgs(bounty2.address, parseEther("500"))

        // poolvalue will have changed, will be 3000, approx poolvalue will be 1000
        await advanceToTimestamp(timeAtStart + 5000, "withdraw earnings from bounty")
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("3000"))
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("1000"))
        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("1000"))

        await pool.connect(delegator).updateApproximatePoolvalueOfBounties([bounty1.address, bounty2.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("3000"))

        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("995"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("5"))
    })

    it("gets notified when kicked (IBroker interface)", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(broker, "1000")
        await setTokens(sponsor, "1000")

        const bounty = await deployBounty(sharedContracts, {}, [], [], undefined, undefined, testKickPolicy)
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "Slash, update pool value")
        await pool.updateApproximatePoolvalueOfBounties([bounty.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("2000"))

        // TestKickPolicy actually kicks and slashes given amount
        await expect(bounty.connect(admin).voteOnFlag(pool.address, hexZeroPad(parseEther("10").toHexString(), 32)))
            .to.emit(bounty, "BrokerKicked").withArgs(pool.address)
            .to.emit(bounty, "BrokerSlashed").withArgs(pool.address, parseEther("10"))
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("1990"))
    })

    it("reduces pool value when it gets slashed without kicking (IBroker interface)", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(broker, "1000")
        await setTokens(sponsor, "1000")

        const bounty = await deployBounty(sharedContracts, {}, [], [], undefined, undefined, testKickPolicy)
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // update poolvalue
        await advanceToTimestamp(timeAtStart + 1000, "slash")
        await pool.updateApproximatePoolvalueOfBounties([bounty.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("2000"))

        await (await bounty.connect(admin).flag(pool.address)).wait() // TestKickPolicy actually slashes 10 ether without kicking
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("1990"))
    })

    it("will NOT let anyone else to stake except the broker of the BrokerPool", async function(): Promise<void> {
        const pool = await deployBrokerPool(sharedContracts, broker)
        const bounty = await deployBounty(sharedContracts)
        await (await sharedContracts.token.mint(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(admin).stake(bounty.address, parseEther("1000")))
            .to.be.revertedWith("error_onlyBroker")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
    })

    it("will NOT allow staking to non-Bounties", async function(): Promise<void> {
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await sharedContracts.token.mint(pool.address, parseEther("1000"))).wait()
        await expect(pool.stake(sharedContracts.token.address, parseEther("1000"))).to.be.revertedWith("error_badBounty")
    })

    it("will NOT allow staking to Bounties that were not created using the correct BountyFactory", async function(): Promise<void> {
        const pool = await deployBrokerPool(sharedContracts, broker)
        const bounty = await deployBounty(sharedContracts)
        const badBounty = sharedContracts.bountyTemplate
        await (await sharedContracts.token.mint(pool.address, parseEther("1000"))).wait()
        await expect(pool.stake(badBounty.address, parseEther("1000")))
            .to.be.revertedWith("error_badBounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
    })

    it("will NOT allow staking if there are delegators queueing to exit", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "5000")

        const bounty = await deployBounty(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("5000"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 25 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()

        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        await expect(pool.connect(delegator).undelegate(parseEther("100")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("100"))

        expect(await pool.queueIsEmpty()).to.be.false
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.be.revertedWith("error_firstEmptyQueueThenStake")

        await expect(pool.unstake(bounty.address))
            .to.emit(pool, "Unstaked")

        expect(await pool.queueIsEmpty()).to.be.true
        await expect(pool.stake(bounty.address, parseEther("500")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("500"))
    })

    it("will NOT allow delegating using wrong token", async function(): Promise<void> {
        const { token } = sharedContracts
        const newToken = await (await (await (await getContractFactory("TestToken", admin)).deploy("Test2", "T2")).deployed())

        await (await newToken.mint(admin.address, parseEther("1000"))).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 25 })
        await expect(newToken.transferAndCall(pool.address, parseEther("100"), "0x"))
            .to.be.revertedWith("error_onlyDATAToken")

        await (await token.mint(admin.address, parseEther("1000"))).wait()
        await expect(token.transferAndCall(pool.address, parseEther("100"), "0x"))
            .to.emit(pool, "Delegated").withArgs(admin.address, parseEther("100"))
    })

    describe("Node addresses", function(): void {
        function dummyAddressArray(length: number): string[] {
            return Array.from({ length }, (_, i) => i).map((i) => `0x${(i + 1).toString().padStart(40, "0")}`)
        }

        it("can ONLY be updated by the broker", async function(): Promise<void> {
            const pool = await deployBrokerPool(sharedContracts, broker)
            await expect(pool.connect(admin).setNodeAddresses([admin.address]))
                .to.be.revertedWith("error_onlyBroker")
            await expect(pool.connect(admin).updateNodeAddresses([], [admin.address]))
                .to.be.revertedWith("error_onlyBroker")
            await expect(pool.setNodeAddresses([admin.address]))
                .to.emit(pool, "NodesSet").withArgs([admin.address])
            await expect(pool.getNodeAddresses()).to.eventually.deep.equal([admin.address])
            await expect(pool.updateNodeAddresses([], [admin.address]))
                .to.emit(pool, "NodesSet").withArgs([])
            await expect(pool.getNodeAddresses()).to.eventually.deep.equal([])
        })

        it("can be set all at once (setNodeAddresses positive test)", async function(): Promise<void> {
            const pool = await deployBrokerPool(sharedContracts, broker)
            const addresses = dummyAddressArray(6)
            await (await pool.setNodeAddresses(addresses.slice(0, 4))).wait()
            expect(await pool.getNodeAddresses()).to.have.members(addresses.slice(0, 4))
            expect(await Promise.all(addresses.map((a) => pool.nodeIndex(a)))).to.deep.equal([1, 2, 3, 4, 0, 0])
            await (await pool.setNodeAddresses(addresses.slice(2, 6))).wait()
            expect(await pool.getNodeAddresses()).to.have.members(addresses.slice(2, 6))
            expect(await Promise.all(addresses.map((a) => pool.nodeIndex(a)))).to.deep.equal([0, 0, 3, 4, 2, 1])
            await (await pool.setNodeAddresses(addresses.slice(1, 5))).wait()
            expect(await pool.getNodeAddresses()).to.have.members(addresses.slice(1, 5))
            expect(await Promise.all(addresses.map((a) => pool.nodeIndex(a)))).to.deep.equal([0, 1, 3, 4, 2, 0])
        })

        it("can be set 'differentially' (updateNodeAddresses positive test)", async function(): Promise<void> {
            const pool = await deployBrokerPool(sharedContracts, broker)
            const addresses = dummyAddressArray(6)
            await (await pool.setNodeAddresses(addresses.slice(0, 4)))

            await (await pool.updateNodeAddresses(addresses.slice(2, 6), addresses.slice(0, 2))).wait()
            expect(await pool.getNodeAddresses()).to.have.members(addresses.slice(2, 6))
            await expect(pool.updateNodeAddresses([], addresses.slice(0, 5)))
                .to.emit(pool, "NodesSet").withArgs([addresses[5]])
            await expect(pool.updateNodeAddresses([], []))
                .to.emit(pool, "NodesSet").withArgs([addresses[5]])
            await expect(pool.updateNodeAddresses([addresses[3]], []))
                .to.emit(pool, "NodesSet").withArgs([addresses[5], addresses[3]])
        })

        it("can call flagging functions", async function(): Promise<void> {
            await setTokens(sponsor, "1000") // accounts 1, 2, 3
            await setTokens(broker, "1000")
            await setTokens(delegator, "1000")
            const {
                bounties: [ bounty ],
                pools: [ flagger, target, voter ]
            } = await setupBounties(sharedContracts, [3], this.test!.title, { sponsor: false })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, "Flag starts")
            await (await flagger.setNodeAddresses([])).wait()
            await expect(flagger.flag(bounty.address, target.address))
                .to.be.revertedWith("error_onlyNodes")

            await (await flagger.setNodeAddresses([await flagger.broker()])).wait()
            await expect(flagger.flag(bounty.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(bounty.address, target.address)

            await advanceToTimestamp(start + VOTE_START, "Voting starts")
            await (await voter.setNodeAddresses([])).wait()
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_onlyNodes")

            await (await voter.setNodeAddresses([await voter.broker()])).wait()
            await expect(voter.voteOnFlag(bounty.address, target.address, VOTE_KICK))
                .to.emit(target, "Unstaked").withArgs(bounty.address, "0", "0")
        })

        it("can call heartbeat", async function(): Promise<void> {
            const pool = await deployBrokerPool(sharedContracts, broker)
            await expect(pool.heartbeat("{}")).to.be.rejectedWith("error_onlyNodes")
            await (await pool.setNodeAddresses([delegator2.address])).wait()
            await expect(pool.connect(delegator2).heartbeat("{}")).to.emit(pool, "Heartbeat").withArgs(delegator2.address, "{}")
        })
    })
})
