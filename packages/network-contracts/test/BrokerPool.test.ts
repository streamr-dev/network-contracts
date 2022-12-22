import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import {
    deployTestContracts,
    deployBountyContract,
    TestContracts,
    advanceToTimestamp,
    getBlockTimestamp,
    newPoolName
} from "./utils"
import { BrokerPool } from "../typechain"

const { parseEther, formatEther } = utils

describe("BrokerPool", (): void => {
    let admin: Wallet
    let broker: Wallet     // creates pool
    let investor: Wallet   // delegates money to pool
    let investor2: Wallet
    let investor3: Wallet
    let sponsor: Wallet     // sponsors stream bounty

    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, broker, investor, investor2, investor3, sponsor] = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(sponsor.address, parseEther("1000000"))).wait()
        await (await token.mint(investor.address, parseEther("1000000"))).wait()
        await (await token.mint(investor2.address, parseEther("1000000"))).wait()
        await (await token.mint(investor3.address, parseEther("1000000"))).wait()
        await (await token.mint(broker.address, parseEther("1000000"))).wait()
    })

    // beforeEach(async (): Promise<void> => {
    //     const brokerPoolRc = await (await contracts.poolFactory.deployBrokerPool(100, 0, 0, newPoolName(),
    //         [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
    //         [0, 0, 0, 0, 0, 20, 0, 0])).wait()
    //     const newPoolAddress = brokerPoolRc.events?.filter((e) => e.event === "NewBrokerPool")[0]?.args?.poolAddress
    //     pool = (await ethers.getContractFactory("BrokerPool")).attach(newPoolAddress) as BrokerPool
    // })
    const deployBrokerPool = async ({maintenanceMarginPercent = 0, maxBrokerDivertPercent = 0, minBrokerStakePercent = 0,
        brokerSharePercent = 0, gracePeriod = 2592000}): Promise<BrokerPool> => {
        // const brokerPoolRc = await (await contracts.poolFactory.connect(broker).deployBrokerPool(0, 2592000, newPoolName(),
        const brokerPoolRc = await (await contracts.poolFactory.connect(broker).deployBrokerPool(
            0,
            gracePeriod,
            newPoolName(),
            [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
            [0, minBrokerStakePercent, 0, maintenanceMarginPercent, minBrokerStakePercent, brokerSharePercent, maxBrokerDivertPercent, 0]
        )).wait()
        const newPoolAddress = brokerPoolRc.events?.filter((e) => e.event === "NewBrokerPool")[0]?.args?.poolAddress
        return (await ethers.getContractFactory("BrokerPool")).attach(newPoolAddress).connect(broker) as BrokerPool
    }

    // it("positivetest configure joinpolicy", async function(): Promise<void> {
    //     const brokerPoolRc = await (await contracts.poolFactory.deployBrokerPool(100, 0, 
    //         0,
    //         newPoolName(),
    //         [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
    //         [0, 0, 0],
    //     )).wait()
    //     const newPoolAddress = brokerPoolRc.events?.filter((e) => e.event === "NewBrokerPool")[0]?.args?.poolAddress
    //     pool = (await ethers.getContractFactory("BrokerPool")).attach(newPoolAddress) as BrokerPool
    // })

    it("allows invest and withdraw", async function(): Promise<void> {
        const { token } = contracts
        const pool = await deployBrokerPool({})
        await (await token.connect(investor).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(investor).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address) // await pool.unallocatedWei()
        // const pooltokensInvestor = await pool.connect(investor).balanceOf(investor.address)

        // await expect(pool.connect(investor).withdraw(parseEther("1000")))
        await expect(pool.connect(investor).queueDataPayout(parseEther("1000")))
            .to.emit(pool, "InvestmentReturned").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterWithdraw = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        expect(formatEther(freeFundsAfterInvest)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterWithdraw)).to.equal("0.0")
    })

    it("allows invest, transfer of poolTokens, and withdraw by 2n party", async function(): Promise<void> {
        const { token } = contracts
        const pool = await deployBrokerPool({})
        await (await token.connect(investor).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(investor).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        // const pooltokensInvestor = await pool.connect(investor).balanceOf(investor.address)

        await (await pool.connect(investor).transfer(investor2.address, parseEther("1000"))).wait()
    
        await expect(pool.connect(investor2).queueDataPayout(parseEther("1000")))
            .to.emit(pool, "InvestmentReturned").withArgs(investor2.address, parseEther("1000"))
        const freeFundsAfterWithdraw = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        expect(formatEther(freeFundsAfterInvest)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterWithdraw)).to.equal("0.0")
    })

    it("stakes, and unstakes with gains", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ brokerSharePercent: 20 })
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
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

    it("negativetest minbrokerstakepercent, cannot join when brokers stake too small", async function(): Promise<void> {
        const { token } = contracts
        const pool = await deployBrokerPool({ minBrokerStakePercent: 10 })
        await expect (token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x"))
            .to.be.revertedWith("error_joinPolicyFailed")
    })

    it("positivetest minbrokerstakepercent, can join", async function(): Promise<void> {
        const { token } = contracts
        const pool = await deployBrokerPool({ minBrokerStakePercent: 10 })
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
    })

    it("positivetest update approximate poolvalue", async function(): Promise<void> {
        const timeAtStart = await getBlockTimestamp()
        const { token } = contracts
        const pool = await deployBrokerPool({ })
        const bounty1 = await deployBountyContract(contracts)
        await (await token.connect(sponsor).transferAndCall(bounty1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await pool.stake(bounty1.address, parseEther("1000"))).wait()
        // some time passes, approx poolvalue differs from real poolvalue
        await advanceToTimestamp(timeAtStart + 1000, "Unstake from bounty")
        let approxPoolValue = await pool.getApproximatePoolValue()
        expect(formatEther(approxPoolValue)).to.equal("1000.0")
        let actualPoolValue = await pool.calculatePoolValueInData(0)
        expect(formatEther(actualPoolValue)).to.equal("2000.0")
        let poolValuePerBounty = await pool.getApproximatePoolValuesPerBounty()
        expect(poolValuePerBounty.bountyAdresses[0]).to.equal(bounty1.address)
        expect(formatEther(poolValuePerBounty.approxValues[0].toString())).to.equal("1000.0")
        expect(formatEther(poolValuePerBounty.realValues[0].toString())).to.equal("2000.0")

        // update approx poolvalue, check if it is correct
        await (await pool.updateApproximatePoolvalueOfBounties([bounty1.address])).wait()
        approxPoolValue = await pool.getApproximatePoolValue()
        expect(formatEther(approxPoolValue)).to.equal("2000.0")
        actualPoolValue = await pool.calculatePoolValueInData(0)
        expect(formatEther(actualPoolValue)).to.equal("2000.0")
        poolValuePerBounty = await pool.getApproximatePoolValuesPerBounty()
        expect(poolValuePerBounty.bountyAdresses[0]).to.equal(bounty1.address)
        expect(formatEther(poolValuePerBounty.approxValues[0].toString())).to.equal("2000.0")
        expect(formatEther(poolValuePerBounty.realValues[0].toString())).to.equal("2000.0")

    })

    it("negativetest minbrokerstakepercent, investor can't join if brokers stake falls too low", async function(): Promise<void> {
        const { token } = contracts
        const pool = await deployBrokerPool({ minBrokerStakePercent: 10 })
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("10000"), "0x")).wait()
        await expect (token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x"))
            .to.be.revertedWith("error_joinPolicyFailed")
    })

    it("positivetest maintenance margin, everything is diverted", async function(): Promise<void> {
        const { token: dataToken } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
        
        // const pool = await deployBrokerPool(20, 100, 0, 20, 2592000)
        const pool = await deployBrokerPool({ maintenanceMarginPercent: 20, maxBrokerDivertPercent: 100, brokerSharePercent: 20 })
        await (await dataToken.connect(broker).transferAndCall(pool.address, parseEther("100"), "0x")).wait()
        const brokersDataBefore = await dataToken.balanceOf(broker.address)
        await (await dataToken.connect(investor).transferAndCall(pool.address, parseEther("900"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        // broker should have 100 poolTokens
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("100.0")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        await advanceToTimestamp(timeAtStart + 500, "get gains")
        await pool.withdrawWinningsFromBounty(bounty.address)
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("500"))
        // broker should not have more DATA since 1000 of his winnings are staked (left in pool)
        const brokersDataAfter = await dataToken.balanceOf(broker.address)
        expect(brokersDataAfter).to.equal(brokersDataBefore)
        // brokers winnings (500 * 20% = 100) DATA are added to the pool and minted for the broker
        expect(formatEther(await pool.balanceOf(broker.address))).to.equal("200.0")
    })

    it("positivetest maintenance margin, enough to reach mainteanc is diverted", async function(): Promise<void> {
        const { token: dataToken } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
        
        // const pool = await deployBrokerPool(50, 100, 0, 20, 2592000)
        const pool = await deployBrokerPool({ maintenanceMarginPercent: 50, maxBrokerDivertPercent: 100, brokerSharePercent: 20 })
        await (await dataToken.connect(broker).transferAndCall(pool.address, parseEther("1"), "0x")).wait()
        await (await dataToken.connect(investor).transferAndCall(pool.address, parseEther("3"), "0x")).wait()
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
    it("revenue sharing szenario", async function(): Promise<void> {
        const { token: dataToken } = contracts
        const balanceInvestorBefore = await dataToken.balanceOf(investor.address)
        // 1

        const bounty = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ brokerSharePercent: 20 })
        await (await dataToken.connect(investor).transferAndCall(pool.address, parseEther("5"), "0x")).wait()
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()
        expect (await pool.connect(investor).getMyBalanceInData()).to.equal(parseEther("5"))

        // 2
        // const balanceBefore = await dataToken.balanceOf(pool.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("5")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("5"))
        // const alloc1 = (await bounty.getAllocation(pool.address)).toString()
        // const a = (await dataToken.balanceOf(pool.address)).toString()
        // 3, 4
        await advanceToTimestamp(timeAtStart + 25, "Unstake from bounty")
        // const alloc2 = (await bounty.getAllocation(pool.address)).toString()
        // const b = (await dataToken.balanceOf(pool.address)).toString()
        await pool.withdrawWinningsFromBounty(bounty.address)
        // const alloc3 = (await bounty.getAllocation(pool.address)).toString()
        // const c = (await dataToken.balanceOf(pool.address)).toString()
        // pool should have 20 (25- 5 broker fee) tokens
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("20"))
        // delegator should still have 5 pooltokens
        const pooltokensInvestor = await pool.balanceOf(investor.address)
        expect(pooltokensInvestor).to.equal(parseEther("5"))
        
        // 5
        // const alloc4 = (await bounty.getAllocation(pool.address)).toString()
        await pool.connect(investor).queueDataPayout(parseEther("5"))
        // const alloc5 = (await bounty.getAllocation(pool.address)).toString()
        const balanceInvestorAfter = await dataToken.balanceOf(investor.address)
        // investor has 5 still staked, was able to withdraw 20
        expect(balanceInvestorAfter).to.equal(balanceInvestorBefore.
            add(parseEther("20").sub(parseEther("5"))))
        // poolvalue is 5stake + 20 = 25; total of 5 pooltoken exist
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal("1000000000000000000")
    })

    it("1 queue entry, is payed out full on winnings withdraw from bounty", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ brokerSharePercent: 20 })
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(investor).queueDataPayout(parseEther("100"))
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        // const a = await pool.totalSupply()
        await pool.withdrawWinningsFromBounty(bounty.address)
        // const b = await pool.totalSupply()
        // winnings are 1000, minus 200 broker fee = 800
        // poolvalue is 1000 stake + 800 winnings = 1800, 1 PT worth 1.8 DATA
        // investor should have start - 1000 stake + 180 winnings
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("180"))
        const balanceAfter = await token.balanceOf(investor.address)

        expect(balanceAfter).to.equal(expectedBalance)
    })

    it("1 queue entry, is payed out partially on winnings withdraw from bounty", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ brokerSharePercent: 20 })
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(investor).queueDataPayout(parseEther("1000"))
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        await pool.withdrawWinningsFromBounty(bounty.address)
        // winnings are 1000, minus 200 broker fee = 800
        // 800 can be payed out
        // poolvalue is 1000 stake + 800 winnings = 1800, 1 PT worth 1.8 DATA
        // PT worth 800 DATA = 800/1.8 = 444.444444444 PT
        // 1000 - 444.444444444... PT = 555.5555555...556 PT
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("800"))
        const balanceAfter = await token.balanceOf(investor.address)
        expect(balanceAfter).to.equal(expectedBalance)

        const investorQueuedPayoutAfter = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayoutAfter.toString()).to.equal("555555555555555555556")

    })

    it("multiple queue places, before and after withdraw winnings from bounty", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ brokerSharePercent: 20 })
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(investor).queueDataPayout(parseEther("500"))
        await pool.connect(investor).queueDataPayout(parseEther("400"))
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther("900"))
        
        await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        await pool.withdrawWinningsFromBounty(bounty.address)
        // TODO: enable next line
        await pool.connect(investor).queueDataPayout(parseEther("100"))
        // now queue should have been paid out from winnings
        // should equal balance before - 1000 (stake still staked) + 8000 (yield)
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("800"))
        const balanceAfter = await token.balanceOf(investor.address)
        expect(balanceAfter).to.equal(expectedBalance)

        const investorQueuedPayoutAfter = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayoutAfter.toString()).to.equal("555555555555555555556")
    })

    it("forced takeout neg+pos case", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ brokerSharePercent: 20 })
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(investor).queueDataPayout(parseEther("100"))
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther("100"))

        // advance time beyond max age of queue spot
        await advanceToTimestamp(timeAtStart + 2591000, "withdraw winnings from bounty")
        await expect (pool.connect(investor).forceUnstake(bounty.address)).to.be.revertedWith("error_only_broker_or_forced")
        await advanceToTimestamp(timeAtStart + 2592002, "withdraw winnings from bounty")
        
        // now anyone can trigger the unstake and payout of the queue
        await (await pool.connect(investor).forceUnstake(bounty.address)).wait()
        // 1000 were staked, 1000 are winnings, with 1000 PT existing, value of 1 PT is 2 DATA,
        // 200 DATA will be payout for his 100 queued PT
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("200"))
        const balanceAfter = await token.balanceOf(investor.address)

        expect(balanceAfter).to.equal(expectedBalance)
    })

    // https://hackmd.io/Tmrj2OPLQwerMQCs_6yvMg
    it("forced example scenario ", async function(): Promise<void> {
        const { token } = contracts
        const bounty1 = await deployBountyContract(contracts, { allocationWeiPerSecond: BigNumber.from("0") })
        const bounty2 = await deployBountyContract(contracts, { allocationWeiPerSecond: BigNumber.from("0") })
        await (await token.connect(sponsor).transferAndCall(bounty1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty2.address, parseEther("1000"), "0x")).wait()
        // const pool = await deployBrokerPool(0, 0, 0, 0, 7*24*60*60)
        const pool = await deployBrokerPool({ })
        // const balanceBefore = await token.balanceOf(investor.address)
        const balanceBeforeInvestor = await token.balanceOf(investor.address)
        const balanceBeforeInvestor2 = await token.balanceOf(investor2.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("10"), "0x")).wait()
        await (await token.connect(investor2).transferAndCall(pool.address, parseEther("10"), "0x")).wait()
        await (await token.connect(investor3).transferAndCall(pool.address, parseEther("10"), "0x")).wait()

        // all delegators have 10 pooltokens
        expect(await pool.balanceOf(investor.address)).to.equal(parseEther("10"))
        expect(await pool.balanceOf(investor2.address)).to.equal(parseEther("10"))
        expect(await pool.balanceOf(investor3.address)).to.equal(parseEther("10"))

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty1.address, parseEther("20")))
            .to.emit(pool, "Staked").withArgs(bounty1.address, parseEther("20"))
        await expect(pool.stake(bounty2.address, parseEther("10")))
            .to.emit(pool, "Staked").withArgs(bounty2.address, parseEther("10"))
        // t = 0 queue payout
        await pool.connect(investor).queueDataPayout(parseEther("10"))
        await pool.connect(investor2).queueDataPayout(parseEther("10"))

        // advance time beyond max age of queue spot
        await advanceToTimestamp(timeAtStart + 2591000, "withdraw winnings from bounty")
        await expect (pool.connect(investor).forceUnstake(bounty1.address)).to.be.revertedWith("error_only_broker_or_forced")
        // t = 2592000
        await advanceToTimestamp(timeAtStart + 3000000, "withdraw winnings from bounty")
        // broker unstakes 5 data from bounty1
        await pool.connect(broker).reduceStake(bounty1.address, parseEther("5"))
        // now anyone can trigger the unstake and payout of the queue
        // await (await pool.updateApproximatePoolvalueOfBounty(bounty2.address)).wait()
        // await (await pool.updateApproximatePoolvalueOfBounty(bounty1.address)).wait()
        await (await pool.connect(investor).forceUnstake(bounty1.address)).wait()
        expect(await token.balanceOf(investor.address)).to.equal(balanceBeforeInvestor)
        expect(await token.balanceOf(investor2.address)).to.equal(balanceBeforeInvestor2)
        expect(await pool.balanceOf(investor3.address)).to.equal(parseEther("10"))
    })

    it("edge case many queue entries, one bounty", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const pool = await deployBrokerPool({ })
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        // await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        const numberOfQueueSlots = 2
        for (let i = 0; i < numberOfQueueSlots; i++) {
            await pool.connect(investor).queueDataPayout(parseEther("1"))
        }
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther(numberOfQueueSlots.toString()))
        
        await pool.connect(broker).unstake(bounty.address, {gasLimit:0xF42400 })

        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther(numberOfQueueSlots.toString()))
        const balanceAfter = await token.balanceOf(investor.address)
        expect(balanceAfter).to.equal(expectedBalance)
    })

    it("edge case many queue entries, one bounty, batched", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const pool = await deployBrokerPool({ })
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        // await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        const numberOfQueueSlots = 1000
        for (let i = 0; i < numberOfQueueSlots; i++) {
            await pool.connect(investor).queueDataPayout(parseEther("1"))
        }
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal(parseEther(numberOfQueueSlots.toString()))
        
        // await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        // doing it in one go with 1000 slots in the queue will fail
        // so only do the unstake, and then do two times 500 slot queue payouts
        await (await pool.connect(broker).unstakeWithoutQueue(bounty.address)).wait()
        await (await pool.connect(broker).payOutQueueWithFreeFunds(500)).wait()
        await (await pool.connect(broker).payOutQueueWithFreeFunds(500)).wait()

        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther(numberOfQueueSlots.toString()))
        const balanceAfter = await token.balanceOf(investor.address)
        expect(balanceAfter).to.equal(expectedBalance)
    })

    it("edge case ony queue entry, many bounties", async function(): Promise<void> {
        const { token } = contracts
        const pool = await deployBrokerPool({ })
        const numberOfBounties = 1000
        for (let i = 0; i < numberOfBounties; i++) {
            const bounty = await deployBountyContract(contracts,  { allocationWeiPerSecond: BigNumber.from("0") })
            // const receipt = 
            await (await token.connect(investor).transferAndCall(pool.address, parseEther("1"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1"), "0x")).wait()
            await (await pool.stake(bounty.address, parseEther("1"))).wait()
            // console.log(`Staked ${i} bounties, gas used: ${receipt.gasUsed}`)
        }
        expect(await pool.balanceOf(investor.address)).to.equal(parseEther(numberOfBounties.toString()))
    })

    it("punish broker on too much diff on approx poolvalue", async function(): Promise<void> {
        const { token } = contracts
        const bounty1 = await deployBountyContract(contracts)
        const bounty2 = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ })
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
        expect(await pool.calculatePoolValueInData(0)).to.equal(parseEther("3000"))
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("1000"))
        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("1000"))

        await pool.connect(investor).updateApproximatePoolvalueOfBounties([bounty1.address, bounty2.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("3000"))

        expect(await pool.balanceOf(broker.address)).to.equal(parseEther("1000").sub(parseEther("5")))
    })

    it("slash listener", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        const pool = await deployBrokerPool({ })
        // const balanceBefore = await token.balanceOf(listener.address)
        await (await token.connect(broker).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))
        
        await advanceToTimestamp(timeAtStart + 1000, "slash")
        // update poolvalue
        await pool.connect(broker).updateApproximatePoolvalueOfBounties([bounty.address])
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("2000"))

        // slash
        await bounty.connect(admin).slash(pool.address, parseEther("5"))
        expect(await pool.getApproximatePoolValue()).to.equal(parseEther("1995"))
    })
})