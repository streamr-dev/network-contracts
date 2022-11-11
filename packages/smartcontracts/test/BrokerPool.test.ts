import { ethers, waffle } from "hardhat"
import { expect, use } from "chai"
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
use(waffle.solidity)

describe("BrokerPool", (): void => {
    const [
        admin,
        broker,
        investor,
        investor2,
        sponsor,
        delegator1,
        delegator2,
        delegator3
    ] = waffle.provider.getWallets() as Wallet[]

    let contracts: TestContracts

    before(async (): Promise<void> => {
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(sponsor.address, parseEther("1000000"))).wait()
        await (await token.mint(investor.address, parseEther("1000000"))).wait()
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
        const brokerPoolRc = await (await contracts.poolFactory.connect(broker).deployBrokerPool(0, gracePeriod, newPoolName(),
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

    it("negativetest minbrokerstakepercent, can't join if brokers stake falls too low", async function(): Promise<void> {
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
        // broker should have 1000 poolTokens
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
        // BUT time advances another second, another 1k allocation, if which 0.8 is counted as poolvalue -> PV = 25 + 0.8 = 25.8
        // 5-(20/(25.8/5)) = 1.124031007751937985 PT left in the queue
        const investorQueuedPayout = await pool.connect(investor).getQueuedPayoutPoolTokens()
        expect(investorQueuedPayout).to.equal("1124031007751937985")
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
        await expect (pool.connect(investor).forceUnstakeAndPayout(bounty.address)).to.be.revertedWith("error_forceTimeNotReached")
        await advanceToTimestamp(timeAtStart + 2592002, "withdraw winnings from bounty")
        
        // now anyone can trigger the unstake and payout of the queue
        await (await pool.connect(investor).forceUnstakeAndPayout(bounty.address)).wait()
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("180"))
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
        await (await token.mint(delegator1.address, parseEther("100"))).wait()
        await (await token.mint(delegator2.address, parseEther("100"))).wait()
        await (await token.mint(delegator3.address, parseEther("100"))).wait()
        await (await token.connect(delegator1).transferAndCall(pool.address, parseEther("10"), "0x")).wait()
        await (await token.connect(delegator2).transferAndCall(pool.address, parseEther("10"), "0x")).wait()
        await (await token.connect(delegator3).transferAndCall(pool.address, parseEther("10"), "0x")).wait()

        // all delegators have 10 pooltokens
        expect(await pool.balanceOf(delegator1.address)).to.equal(parseEther("10"))
        expect(await pool.balanceOf(delegator2.address)).to.equal(parseEther("10"))
        expect(await pool.balanceOf(delegator3.address)).to.equal(parseEther("10"))

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty1.address, parseEther("20")))
            .to.emit(pool, "Staked").withArgs(bounty1.address, parseEther("20"))
        await expect(pool.stake(bounty2.address, parseEther("10")))
            .to.emit(pool, "Staked").withArgs(bounty2.address, parseEther("10"))

        // t = 0 queue payout
        await pool.connect(delegator1).queueDataPayout(parseEther("10"))
        await pool.connect(delegator2).queueDataPayout(parseEther("10"))

        // advance time beyond max age of queue spot
        await advanceToTimestamp(timeAtStart + 2591000, "withdraw winnings from bounty")
        await expect (pool.connect(delegator1).forceUnstakeAndPayout(bounty1.address)).to.be.revertedWith("error_forceTimeNotReached")

        // t = 2592000
        await advanceToTimestamp(timeAtStart + 3000000, "withdraw winnings from bounty")
        
        // broker unstakes 5 data from bounty1
        await pool.connect(broker).reduceStake(bounty1.address, parseEther("5"))

        // now anyone can trigger the unstake and payout of the queue
        await (await pool.connect(investor).forceUnstakeAndPayout(bounty1.address)).wait()
        expect(await token.balanceOf(delegator1.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(delegator2.address)).to.equal(parseEther("100"))
        expect(await pool.balanceOf(delegator3.address)).to.equal(parseEther("10"))
    })
})
