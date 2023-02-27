import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp } from "./utils"
import { deployBrokerPool } from "./deployBrokerPool"

import { deployBountyContract } from "./deployBountyContract"
import { IKickPolicy } from "../../../typechain"

const { parseEther, formatEther } = utils
const { getSigners, getContractFactory } = hardhatEthers

describe("BrokerPool", (): void => {
    let admin: Wallet
    let broker: Wallet     // creates pool
    let delegator: Wallet   // delegates money to pool
    let delegator2: Wallet
    let delegator3: Wallet
    let sponsor: Wallet     // sponsors stream bounty

    // many tests don't need their own clean set of contracts that take time to deploy
    let sharedContracts: TestContracts
    let testBountyKickPolicy: IKickPolicy

    before(async (): Promise<void> => {
        [admin, broker, delegator, delegator2, delegator3, sponsor] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(admin)

        testBountyKickPolicy = await (await (await getContractFactory("TestBountyKickPolicy", admin)).deploy()).deployed() as unknown as IKickPolicy
        await (await sharedContracts.bountyFactory.addTrustedPolicies([ testBountyKickPolicy.address])).wait()

        const { token } = sharedContracts
        await (await token.mint(sponsor.address, parseEther("1000000"))).wait()
        await (await token.mint(delegator.address, parseEther("1000000"))).wait()
        await (await token.mint(broker.address, parseEther("1000000"))).wait()
    })

    it("allows invest and withdraw", async function(): Promise<void> {
        const { token } = sharedContracts
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(delegator).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(delegator.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address)

        await expect(pool.connect(delegator).queueDataPayout(parseEther("1000")))
            .to.emit(pool, "InvestmentReturned").withArgs(delegator.address, parseEther("1000"))
        const freeFundsAfterWithdraw = await token.balanceOf(pool.address)

        expect(formatEther(freeFundsAfterInvest)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterWithdraw)).to.equal("0.0")
    })

    it("allows invest, transfer of poolTokens, and withdraw by another investor", async function(): Promise<void> {
        const { token } = sharedContracts
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(delegator).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(delegator.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address)

        await (await pool.connect(delegator).transfer(delegator2.address, parseEther("1000"))).wait()

        await expect(pool.connect(delegator2).queueDataPayout(parseEther("1000")))
            .to.emit(pool, "InvestmentReturned").withArgs(delegator2.address, parseEther("1000"))
        const freeFundsAfterWithdraw = await token.balanceOf(pool.address)

        expect(formatEther(freeFundsAfterInvest)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterWithdraw)).to.equal("0.0")
    })

    it("stakes, and unstakes with gains", async function(): Promise<void> {
        const { token } = sharedContracts
        const bounty = await deployBountyContract(sharedContracts)
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const balanceBefore = await token.balanceOf(pool.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "Unstake from bounty")
        await expect(pool.unstake(bounty.address, 10))
            .to.emit(pool, "Unstaked").withArgs(bounty.address, parseEther("1000"), parseEther("1000"))

        const gains = (await token.balanceOf(pool.address)).sub(balanceBefore)
        expect(formatEther(gains)).to.equal("800.0") // 200 broker fee
    })

    it("negativetest minbrokerstakepercent, cannot join when brokers stake too small", async function(): Promise<void> {
        const { token } = sharedContracts
        const pool = await deployBrokerPool(sharedContracts, broker, { minBrokerStakePercent: 10 })
        // broker should have 111.2 pool tokens, but has nothing
        await expect(token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x"))
            .to.be.revertedWith("error_joinPolicyFailed")
    })

    it("negativetest minbrokerstakepercent, investor can't join if the broker's stake would fall too low", async function(): Promise<void> {
        const { token } = sharedContracts
        const pool = await deployBrokerPool(sharedContracts, broker, { minBrokerStakePercent: 10 })
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("10000"), "0x")).wait()
        await expect (token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x"))
            .to.be.revertedWith("error_joinPolicyFailed")
    })

    it("positivetest minbrokerstakepercent, can join", async function(): Promise<void> {
        const { token } = sharedContracts
        const pool = await deployBrokerPool(sharedContracts, broker, { minBrokerStakePercent: 10 })
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("113"), "0x")).wait()
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
    })

    it("positivetest update approximate poolvalue", async function(): Promise<void> {
        const timeAtStart = await getBlockTimestamp()
        const { token } = sharedContracts
        const pool = await deployBrokerPool(sharedContracts, broker)
        const bounty1 = await deployBountyContract(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await pool.stake(bounty1.address, parseEther("1000"))).wait()

        // some time passes => approx poolvalue differs from real poolvalue
        await advanceToTimestamp(timeAtStart + 1000, "Unstake from bounty")

        const approxPoolValueBefore = await pool.getApproximatePoolValue()
        const actualPoolValueBefore = await pool.calculatePoolValueInData()
        const poolValuePerBountyBefore = await pool.getApproximatePoolValuesPerBounty()

        await (await pool.updateApproximatePoolvalueOfBounties([bounty1.address])).wait()

        const approxPoolValueAfter = await pool.getApproximatePoolValue()
        const actualPoolValueAfter = await pool.calculatePoolValueInData()
        const poolValuePerBountyAfter = await pool.getApproximatePoolValuesPerBounty()

        expect(formatEther(approxPoolValueBefore)).to.equal("1000.0")
        expect(formatEther(actualPoolValueBefore)).to.equal("2000.0")
        expect(formatEther(poolValuePerBountyBefore.approxValues[0])).to.equal("1000.0")
        expect(formatEther(poolValuePerBountyBefore.realValues[0])).to.equal("2000.0")
        expect(poolValuePerBountyBefore.bountyAdresses[0]).to.equal(bounty1.address)

        expect(formatEther(approxPoolValueAfter)).to.equal("2000.0")
        expect(formatEther(actualPoolValueAfter)).to.equal("2000.0")
        expect(formatEther(poolValuePerBountyAfter.approxValues[0])).to.equal("2000.0")
        expect(formatEther(poolValuePerBountyAfter.realValues[0])).to.equal("2000.0")
        expect(poolValuePerBountyAfter.bountyAdresses[0]).to.equal(bounty1.address)
    })

    it("positivetest maintenance margin, everything is diverted", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts
        const bounty = await deployBountyContract(sharedContracts)
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const pool = await deployBrokerPool(sharedContracts, broker, {
            maintenanceMarginPercent: 20, maxBrokerDivertPercent: 100, brokerSharePercent: 20
        })
        await (await dataToken.connect(broker).transferAndCall(pool.address, parseEther("100"), "0x")).wait()
        await (await dataToken.connect(delegator).transferAndCall(pool.address, parseEther("900"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        const brokersDataBefore = await dataToken.balanceOf(broker.address)

        // broker staked 100 DATA so they should have 100 BrokerPool tokens
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("100.0")

        await advanceToTimestamp(timeAtStart + 500, "Withdraw earnings from bounty")
        await pool.withdrawWinningsFromBounty(bounty.address)
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("500"))

        // despite brokerSharePercent=20%, broker should not have more DATA since 1000 of his winnings are staked (left in pool)
        const brokersDataAfter = await dataToken.balanceOf(broker.address)
        expect(brokersDataAfter).to.equal(brokersDataBefore)

        // broker's share of (500 * 20% = 100) DATA are added to the pool and minted for the broker
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("200.0")
        // TODO: add getter for the "margin" (and rename it?), test for it directly
    })

    it("positivetest maintenance margin, enough to reach mainteanc is diverted", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts
        const bounty = await deployBountyContract(sharedContracts)
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const pool = await deployBrokerPool(sharedContracts, broker, {
            maintenanceMarginPercent: 50, maxBrokerDivertPercent: 100, brokerSharePercent: 20
        })
        await (await dataToken.connect(broker).transferAndCall(pool.address, parseEther("1"), "0x")).wait()
        await (await dataToken.connect(delegator).transferAndCall(pool.address, parseEther("3"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("1.0")
        await expect(pool.stake(bounty.address, parseEther("4")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("4"))
        await advanceToTimestamp(timeAtStart + 500, "get gains")
        await pool.withdrawWinningsFromBounty(bounty.address)

        // broker had 1 of 4 PT, 25% but needs 50% to reach maintenance margin
        // so DATA in value of 2PT are diverted and minted for the broker
        // then he has 3 of 6 PT, 50%
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("3.0")
        expect(formatEther(await pool.totalSupply())).to.equal("6.0")
    })

    // https://hackmd.io/QFmCXi8oT_SMeQ111qe6LQ
    it("revenue sharing scenarios 1..7: happy path pool life cycle", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts

        // Setup:
        // - There is one single delegator with funds of 10 DATA and no delegations.
        await (await dataToken.connect(delegator).transfer(admin.address, await dataToken.balanceOf(delegator.address))).wait() // burn all tokens
        await (await dataToken.connect(broker).transfer(admin.address, await dataToken.balanceOf(broker.address))).wait() // burn all tokens
        await (await dataToken.mint(delegator.address, parseEther("10"))).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 }) // policy needed in part 4

        // 1: Simple Join/Delegate
        // "There is a maximum allocation policy of 5 DATA in this system." not implemented => simulate by only delegating 5 DATA
        await (await dataToken.connect(delegator).transferAndCall(pool.address, parseEther("5"), "0x")).wait()

        expect(await pool.connect(delegator).getMyBalanceInData()).to.equal(parseEther("5"))
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("5"))
        expect(await pool.totalSupply()).to.equal(parseEther("5"))

        // Setup for 2: sponsorship must be only 25 so at #6, Unstaked returns allocation=0
        const bounty = await deployBountyContract(sharedContracts)
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("25"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        // 2: Simple Staking
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("5")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("5"))

        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await dataToken.balanceOf(bounty.address)).to.equal(parseEther("30")) // 25 sponsorship + 5 stake
        expect(await pool.getPoolValueFromBounty(bounty.address)).to.equal(parseEther("5"))
        expect(await bounty.getStake(pool.address)).to.equal(parseEther("5"))
        expect(await bounty.getAllocation(pool.address)).to.equal(parseEther("0"))

        // 3: Yield Allocated to Accounts
        // Skip this: there is no yield allocation policy that sends incoming winnings directly to delegators

        // 4: Yield Allocated to Pool Value
        await advanceToTimestamp(timeAtStart + 100, "Withdraw from bounty") // bounty only has 25 DATA sponsorship, so that's what it will allocate
        await (await pool.withdrawWinningsFromBounty(bounty.address)).wait()
        // TODO: add event to BrokerPool
        // await expect(pool.withdrawWinningsFromBounty(bounty.address))
        //    .to.emit(pool, "Withdrawn").withArgs(bounty.address, parseEther("25"))

        expect(await dataToken.balanceOf(broker.address)).to.equal(parseEther("5"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("25"))
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("20"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("5"))
        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("5"))

        // 5: Withdraw
        // Because the pool value is equal to 25 and the number of pool tokens is equal to 5, the exchange rate is 25/5.
        // This values each pool token as being worth 5 data.
        // Because there is 20 in terms of funds that is available currently, that is the amount of DATA which will be paid out.
        // 20 DATA / 5 Exchange Rate = 4 Pool Tokens are paid out, 1 pool token payout is put into the queue.
        await expect(pool.connect(delegator).queueDataPayout(parseEther("5")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("5"))
            .to.emit(pool, "InvestmentReturned").withArgs(delegator.address, parseEther("20"))
            .to.emit(pool, "QueueUpdated").withArgs(delegator.address, parseEther("1"))

        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("25")) // +20
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("1"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("5"))
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("1"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("1"))

        // 6: Pay out the queue by unstaking
        await expect(pool.connect(broker).unstake(bounty.address, 10))
            .to.emit(pool, "Unstaked").withArgs(bounty.address, parseEther("5"), parseEther("0"))
            .to.emit(pool, "InvestmentReturned").withArgs(delegator.address, parseEther("5"))
            .to.not.emit(pool, "Losses")

        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("0"))
        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("30")) // +5
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("0"))
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
        const bounty = await deployBountyContract(sharedContracts)
        // await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("25"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 }) // policy needed in part 4
        await (await dataToken.connect(delegator).transferAndCall(pool.address, parseEther("5"), "0x")).wait()
        await expect(pool.stake(bounty.address, parseEther("5")))

        // 8: Slashing
        await expect(bounty.slash(pool.address, parseEther("5")))
            .to.emit(bounty, "StakeUpdate").withArgs(pool.address, parseEther("0"), parseEther("0"))

        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("5"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("0"))
    })

    it("broker withdraws all of its stake, pool value goes to zero, no one can join anymore", async function(): Promise<void> {
        // TODO
    })

    it("1 queue entry, is fully paid out using winnings withdrawn from bounty", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        await expect(pool.connect(delegator).queueDataPayout(parseEther("100")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("100"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("100"))

        // winnings are 1 token/second * 1000 seconds = 1000, minus 200 broker fee = 800 DATA
        // poolvalue is 1000 stake + 800 winnings = 1800 DATA
        // There are 1000 PoolTokens => exchange rate is 1800 / 1000 = 1.8 DATA/PoolToken
        // delegator should receive a payout: 100 PoolTokens * 1.8 DATA = 180 DATA

        await advanceToTimestamp(timeAtStart + 1000, "Withdraw winnings from bounty")
        await expect(pool.withdrawWinningsFromBounty(bounty.address))
        // TODO: add event to BrokerPool
        //    .to.emit(pool, "WinningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
            .to.emit(pool, "InvestmentReturned").withArgs(delegator.address, parseEther("180"))
        //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))

        expect(formatEther(await token.balanceOf(delegator.address))).to.equal("180.0")
        expect(formatEther(await token.balanceOf(pool.address))).to.equal("620.0")
    })

    it("1 queue entry, is partially paid out using winnings withdrawn from bounty", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("5000"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 25 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        await expect(pool.connect(delegator).queueDataPayout(parseEther("1000")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("1000"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("1000"))

        // winnings are 2000, minus 500 broker fee = 1500 DATA
        // 1500 DATA will be paid out
        // poolvalue is 1000 stake + 1500 winnings = 2500 DATA
        // There are 1000 PoolTokens => exchange rate is 2500 / 1000 = 2.5 DATA/PoolToken
        // PoolTokens to be burned: 1500 DATA = 1500/2.5 = 600 PoolTokens
        // Left in the queue: 1000 - 600 = 400 PoolTokens
        await advanceToTimestamp(timeAtStart + 2000, "withdraw winnings from bounty")
        await expect(pool.withdrawWinningsFromBounty(bounty.address))
            .to.emit(pool, "Transfer").withArgs(delegator.address, "0x0000000000000000000000000000000000000000", parseEther("600"))
        //    .to.emit(pool, "WinningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
            .to.emit(pool, "InvestmentReturned").withArgs(delegator.address, parseEther("1500"))
        //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))
        expect(formatEther(await pool.connect(delegator).getMyQueuedPayoutPoolTokens())).to.equal("400.0")
        expect(formatEther(await token.balanceOf(delegator.address))).to.equal("1500.0")
        expect(formatEther(await token.balanceOf(pool.address))).to.equal("0.0")
    })

    it("multiple queue places, before and after withdraw winnings from bounty", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts)
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
        const balanceBefore = await token.balanceOf(delegator.address)
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(delegator).queueDataPayout(parseEther("500"))
        await pool.connect(delegator).queueDataPayout(parseEther("400"))
        const investorQueuedPayout = await pool.connect(delegator).getMyQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther("900"))

        await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        await pool.withdrawWinningsFromBounty(bounty.address)
        // TODO: enable next line
        await pool.connect(delegator).queueDataPayout(parseEther("100"))
        // now queue should have been paid out from winnings
        // should equal balance before - 1000 (stake still staked) + 800 (yield)
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("800"))
        const balanceAfter = await token.balanceOf(delegator.address)
        expect(balanceAfter).to.equal(expectedBalance)

        const investorQueuedPayoutAfter = await pool.connect(delegator).getMyQueuedPayoutPoolTokens()
        expect(investorQueuedPayoutAfter.toString()).to.equal("555555555555555555556")
    })

    it("delegator moves their pool tokens away while queueing for exit", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        await expect(pool.connect(delegator).queueDataPayout(parseEther("600")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("600"))

        // move pool tokens away, leave only 100 to the delegator; that will be the whole amount of the exit, not 600
        await pool.connect(delegator).transfer(sponsor.address, parseEther("900"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("600"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 1000, "Withdraw winnings from bounty")
        await expect(pool.withdrawWinningsFromBounty(bounty.address))
        // TODO: add event to BrokerPool
        //    .to.emit(pool, "WinningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
            .to.emit(pool, "InvestmentReturned").withArgs(delegator.address, parseEther("180"))
        //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))

        // winnings are 1000, minus 200 broker fee = 800 DATA
        // poolvalue is 1000 stake + 800 winnings = 1800 DATA
        // There are 1000 PoolTokens => exchange rate is 1800 / 1000 = 1.8 DATA/PoolToken
        // delegator should receive a payout: 100 PoolTokens * 1.8 DATA = 180 DATA
        expect(formatEther(await token.balanceOf(delegator.address))).to.equal("180.0")
        expect(formatEther(await token.balanceOf(pool.address))).to.equal("620.0")
    })

    it("delegator moves ALL their pool tokens away while queueing for exit", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty + queue the payout") // no free funds in the pool => no payout
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        await expect(pool.connect(delegator).queueDataPayout(parseEther("600")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("600"))

        // move pool tokens away, nothing can be exited, although nominally there's still 600 in the queue
        await pool.connect(delegator).transfer(sponsor.address, parseEther("1000"))
        expect(await pool.connect(delegator).getMyQueuedPayoutPoolTokens()).to.equal(parseEther("600"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("0"))

        await advanceToTimestamp(timeAtStart + 1000, "Withdraw winnings from bounty")
        await expect(pool.withdrawWinningsFromBounty(bounty.address))
        // TODO: add event to BrokerPool
        //    .to.emit(pool, "WinningsWithdrawn").withArgs(bounty.address, parseEther("1000"))
            .to.not.emit(pool, "InvestmentReturned")
        //    .to.emit(pool, "BrokerSharePaid").withArgs(bounty.address, parseEther("200"))

        // winnings are 1000, minus 200 broker fee = 800 DATA
        expect(formatEther(await token.balanceOf(delegator.address))).to.equal("0.0")
        expect(formatEther(await token.balanceOf(pool.address))).to.equal("800.0")
    })

    it("forced takeout neg+pos case", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts)
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 20 })
        const balanceBefore = await token.balanceOf(delegator.address)
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(delegator).queueDataPayout(parseEther("100"))
        const investorQueuedPayout = await pool.connect(delegator).getMyQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther("100"))

        // advance time beyond max age of queue spot
        await advanceToTimestamp(timeAtStart + 2591000, "withdraw winnings from bounty")
        await expect (pool.connect(delegator).forceUnstake(bounty.address, 10)).to.be.revertedWith("error_gracePeriod")
        await advanceToTimestamp(timeAtStart + 2592002, "withdraw winnings from bounty")

        // now anyone can trigger the unstake and payout of the queue
        await (await pool.connect(delegator).forceUnstake(bounty.address, 10)).wait()
        // 1000 were staked, 1000 are winnings, with 1000 PT existing, value of 1 PT is 2 DATA,
        // 200 DATA will be payout for his 100 queued PT
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("200"))
        const balanceAfter = await token.balanceOf(delegator.address)

        expect(balanceAfter).to.equal(expectedBalance)
    })

    // https://hackmd.io/Tmrj2OPLQwerMQCs_6yvMg
    it("forced example scenario", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.connect(delegator2).transfer(admin.address, await token.balanceOf(delegator2.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("10"))).wait()
        await (await token.mint(delegator2.address, parseEther("10"))).wait()
        await (await token.mint(delegator3.address, parseEther("10"))).wait()

        const days = 24 * 60 * 60
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("10"), "0x")).wait()
        await (await token.connect(delegator2).transferAndCall(pool.address, parseEther("10"), "0x")).wait()
        await (await token.connect(delegator3).transferAndCall(pool.address, parseEther("10"), "0x")).wait()

        const bounty1 = await deployBountyContract(sharedContracts)
        const bounty2 = await deployBountyContract(sharedContracts)
        await pool.stake(bounty1.address, parseEther("20"))
        await pool.stake(bounty2.address, parseEther("10"))

        const timeAtStart = await getBlockTimestamp()

        // Starting state
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("10"))
        expect(await pool.balanceOf(delegator2.address)).to.equal(parseEther("10"))
        expect(await pool.balanceOf(delegator3.address)).to.equal(parseEther("10"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("30"))
        expect(await token.balanceOf(pool.address)).to.equal(parseEther("0"))
        expect(await pool.queueIsEmpty()).to.equal(true)

        await advanceToTimestamp(timeAtStart + 0*days, "Delegator 1 enters the exit queue")
        await pool.connect(delegator).queueDataPayout(parseEther("10"))

        await advanceToTimestamp(timeAtStart + 5*days, "Delegator 2 enters the exit queue")
        await pool.connect(delegator2).queueDataPayout(parseEther("10"))

        await advanceToTimestamp(timeAtStart + 29*days, "Delegator 1 wants to force-unstake too early")
        await expect(pool.connect(delegator).forceUnstake(bounty1.address, 10)).to.be.revertedWith("error_gracePeriod")

        await advanceToTimestamp(timeAtStart + 31*days, "Broker unstakes 5 data from bounty1")
        await pool.connect(broker).reduceStake(bounty1.address, parseEther("5"))

        // bounty1 has 15 stake left, bounty2 has 10 stake left
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("5"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("25"))

        // now anyone can trigger the unstake and payout of the queue
        // await (await pool.updateApproximatePoolvalueOfBounty(bounty2.address)).wait()
        // await (await pool.updateApproximatePoolvalueOfBounty(bounty1.address)).wait()
        await expect(pool.connect(delegator2).forceUnstake(bounty1.address, 10))
            .to.emit(pool, "Unstaked").withArgs(bounty1.address, parseEther("15"), parseEther("0"))

        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("10"))
        expect(await token.balanceOf(delegator2.address)).to.equal(parseEther("10"))
        expect(await token.balanceOf(delegator3.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator2.address)).to.equal(parseEther("0"))
        expect(await pool.balanceOf(delegator3.address)).to.equal(parseEther("10"))
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("10"))
        expect(await pool.queueIsEmpty()).to.equal(true)
    })

    it("edge case many queue entries, one bounty", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
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
            await pool.connect(delegator).queueDataPayout(parseEther("1"))
        }
        const investorQueuedPayout = await pool.connect(delegator).getMyQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther(numberOfQueueSlots.toString()))

        await pool.connect(broker).unstake(bounty.address, 10, { gasLimit: 0xF42400 })

        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther(numberOfQueueSlots.toString()))
        const balanceAfter = await token.balanceOf(delegator.address)
        expect(balanceAfter).to.equal(expectedBalance)
    })

    it("punishes broker on too much diff on approx poolvalue", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty1 = await deployBountyContract(sharedContracts)
        const bounty2 = await deployBountyContract(sharedContracts)
        const pool = await deployBrokerPool(sharedContracts, broker)
        // const balanceBefore = await token.balanceOf(broker.address)
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty2.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty1.address, parseEther("500")))
            .to.emit(pool, "Staked").withArgs(bounty1.address, parseEther("500"))
        await expect(pool.stake(bounty2.address, parseEther("500")))
            .to.emit(pool, "Staked").withArgs(bounty2.address, parseEther("500"))

        await advanceToTimestamp(timeAtStart + 5000, "withdraw winnings from bounty")
        // poolvalue will have changed, will be 3000, approx poolvalue will be 1000
        expect(await pool.calculatePoolValueInData()).to.equal(parseEther("3000"))
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("1000"))
        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("1000"))

        await pool.connect(delegator).updateApproximatePoolvalueOfBounties([bounty1.address, bounty2.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("3000"))

        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("1000").sub(parseEther("5")))
    })

    it("gets notified when kicked (slash listener)", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(broker).transfer(admin.address, await token.balanceOf(broker.address))).wait() // burn all tokens
        await (await token.mint(broker.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts, {}, [], [], undefined, undefined, testBountyKickPolicy)
        const pool = await deployBrokerPool(sharedContracts, broker)
        // const balanceBefore = await token.balanceOf(listener.address)
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // update poolvalue
        await advanceToTimestamp(timeAtStart + 1000, "slash")
        await pool.connect(broker).updateApproximatePoolvalueOfBounties([bounty.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("2000"))

        await expect(bounty.connect(admin).kick(pool.address))
            .to.emit(bounty, "BrokerKicked").withArgs(pool.address, parseEther("0"))
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("2000"))
    })

    it("gets notified when slashed (slash listener)", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(broker).transfer(admin.address, await token.balanceOf(broker.address))).wait() // burn all tokens
        await (await token.mint(broker.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts, {}, [], [], undefined, undefined, testBountyKickPolicy)
        const pool = await deployBrokerPool(sharedContracts, broker)
        // const balanceBefore = await token.balanceOf(listener.address)
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // update poolvalue
        await advanceToTimestamp(timeAtStart + 1000, "slash")
        await pool.connect(broker).updateApproximatePoolvalueOfBounties([bounty.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("2000"))

        await (await bounty.connect(admin).flag(pool.address, pool.address)).wait()
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("1990"))
    })

    it("will NOT let anyone else to stake except the broker of the BrokerPool", async function(): Promise<void> {
        const pool = await deployBrokerPool(sharedContracts, broker)
        const bounty = await deployBountyContract(sharedContracts)
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
        const bounty = await deployBountyContract(sharedContracts)
        const badBounty = sharedContracts.bountyTemplate
        await (await sharedContracts.token.mint(pool.address, parseEther("1000"))).wait()
        await expect(pool.stake(badBounty.address, parseEther("1000")))
            .to.be.revertedWith("error_badBounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
    })

    it("will NOT allow staking if there are delegators queueing to exit", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const bounty = await deployBountyContract(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("5000"), "0x")).wait()
        const pool = await deployBrokerPool(sharedContracts, broker, { brokerSharePercent: 25 })
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()

        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        await expect(pool.connect(delegator).queueDataPayout(parseEther("100")))
            .to.emit(pool, "QueuedDataPayout").withArgs(delegator.address, parseEther("100"))

        expect(await pool.queueIsEmpty()).to.be.false
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.be.revertedWith("error_firstEmptyQueueThenStake")

        await expect(pool.unstake(bounty.address, "10"))
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
            .to.emit(pool, "InvestmentReceived").withArgs(admin.address, parseEther("100"))
    })
})
