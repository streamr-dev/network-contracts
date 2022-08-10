import { ethers, waffle } from "hardhat"
import { expect, use } from "chai"
import { utils } from "ethers"

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

describe.only("BrokerPool", (): void => {
    const [
        admin,
        broker,
        investor,
        investor2,
        sponsor,
    ] = waffle.provider.getWallets()

    let contracts: TestContracts
    let pool: BrokerPool

    before(async (): Promise<void> => {
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(sponsor.address, parseEther("1000000"))).wait()
        await (await token.mint(investor.address, parseEther("1000000"))).wait()
    })

    beforeEach(async (): Promise<void> => {
        const brokerPoolRc = await (await contracts.poolFactory.deployBrokerPool(0, newPoolName(),
            [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
            [0, 20, 0])).wait()
        const newPoolAddress = brokerPoolRc.events?.filter((e) => e.event === "NewBrokerPool")[0]?.args?.poolAddress
        pool = (await ethers.getContractFactory("BrokerPool")).attach(newPoolAddress) as BrokerPool
    })

    // it("positivetest configure joinpolicy", async function(): Promise<void> {
    //     const brokerPoolRc = await (await contracts.poolFactory.deployBrokerPool(
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
        // const pool = await deployBrokerPool(broker, token)
        await (await token.connect(investor).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(investor).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address) // await pool.unallocatedWei()
        const pooltokensInvestor = await pool.connect(investor).balanceOf(investor.address)

        // await expect(pool.connect(investor).withdraw(parseEther("1000")))
        await expect(pool.connect(investor).queueDataPayout(parseEther("1000")))
            .to.emit(pool, "InvestmentReturned").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterWithdraw = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        expect(formatEther(freeFundsAfterInvest)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterWithdraw)).to.equal("0.0")
    })

    it("allows invest, transfer of poolTokens, and withdraw by 2n party", async function(): Promise<void> {
        const { token } = contracts
        // const pool = await deployBrokerPool(broker, token)
        await (await token.connect(investor).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(investor).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        const pooltokensInvestor = await pool.connect(investor).balanceOf(investor.address)

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
        // const pool = await deployBrokerPool(broker, token)
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

    // https://hackmd.io/QFmCXi8oT_SMeQ111qe6LQ
    it.only("revenue sharing szenario", async function(): Promise<void> {
        const { token: dataToken } = contracts
        const balanceInvestorBefore = await dataToken.balanceOf(investor.address)
        // 1

        const bounty = await deployBountyContract(contracts)
        // const pool = await deployBrokerPool(broker, token)
        await (await dataToken.connect(investor).transferAndCall(pool.address, parseEther("5"), "0x")).wait()
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        // 2
        const balanceBefore = await dataToken.balanceOf(pool.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("5")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("5"))
        const allocbefore = (await bounty.getAllocation(pool.address)).toString()
        const a = (await dataToken.balanceOf(pool.address)).toString()
        // 3, 4
        await advanceToTimestamp(timeAtStart + 25, "Unstake from bounty")
        const allocafter = (await bounty.getAllocation(pool.address)).toString()
        const b = (await dataToken.balanceOf(pool.address)).toString()
        await pool.withdrawWinningsFromBounty(bounty.address)
        const c = (await dataToken.balanceOf(pool.address)).toString()
        // pool should have 20 (25- 5 broker fee) tokens
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("20"))
        // delegator should still have 5 pooltokens
        const pooltokensInvestor = await pool.balanceOf(investor.address)
        expect(pooltokensInvestor).to.equal(parseEther("5"))
        
        // 5
        await pool.connect(investor).queueDataPayout(parseEther("5"))
        const balanceInvestorAfter = await dataToken.balanceOf(investor.address)
        // investor has 5 still staked, was able to withdraw 20
        expect(balanceInvestorAfter).to.equal(balanceInvestorBefore.
            add(parseEther("20").sub(parseEther("5"))))
        const investorQueuedPayout = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayout).to.equal(parseEther("5"))
    })

    it("1 queue entry, is payed out full on winnings withdraw from bounty", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        // const pool = await deployBrokerPool(broker, token)
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(investor).queueDataPayout(parseEther("100"))
        const investorQueuedPayout = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayout).to.equal(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        await pool.withdrawWinningsFromBounty(bounty.address)
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
        // const pool = await deployBrokerPool(broker, token)
        const balanceBefore = await token.balanceOf(investor.address)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        await pool.connect(investor).queueDataPayout(parseEther("1000"))
        const investorQueuedPayout = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayout).to.equal(parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        await pool.withdrawWinningsFromBounty(bounty.address)
        // winnings are 1000, minus 200 broker fee = 800
        // 800 can be payed out
        // poolvalue is 1000 stake + 800 winnings = 1800, 1 PT worth 1.8 DATA
        // PT worth 800 DATA = 800/1.8 = 444.444444444 PT
        // 1000 - 444.444444444 PT = 555.5555555556 PT
        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("800"))
        const balanceAfter = await token.balanceOf(investor.address)
        expect(balanceAfter).to.equal(expectedBalance)

        const investorQueuedPayoutAfter = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayoutAfter).to.equal(parseEther("555555555555555555556"))

    })

    it("multiple queue places, before and after withdrawwinnings from bounty", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
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
        const investorQueuedPayout = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayout).to.equal(parseEther("900"))
        
        await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        await pool.withdrawWinningsFromBounty(bounty.address)
        // TODO: enable next line
        await pool.connect(investor).queueDataPayout(parseEther("100"))
        // now queue should have been paid out from winnings
        // should equal balance before - 1000 (stake still staked) + 1000 (yield)
        expect (await token.balanceOf(investor.address)).to.equal(balanceBefore)
    })
})

// 999000 000000000000000000
//   1000 000000000000000000